import { useState, useEffect, useRef, useCallback } from 'react';
import { Message, ConnectionStatus } from '../types';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

function getWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

export function useChat() {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isHost, setIsHost] = useState<boolean | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const iceCandidateQueueRef = useRef<RTCIceCandidateInit[]>([]);

  // addMessage은 함수형 업데이트로 stable하게 유지
  const addMessage = useCallback((text: string, sender: Message['sender']) => {
    setMessages((prev) => [
      ...prev,
      { id: generateId(), text, sender, timestamp: new Date() },
    ]);
  }, []);

  const setupDataChannel = useCallback(
    (dc: RTCDataChannel) => {
      dcRef.current = dc;

      dc.onopen = () => {
        setStatus('connected');
        addMessage('✅ 연결되었습니다! 채팅을 시작하세요.', 'system');
      };

      dc.onclose = () => {
        setStatus('disconnected');
        addMessage('🔌 DataChannel이 닫혔습니다.', 'system');
      };

      dc.onerror = (e) => {
        console.error('DataChannel 오류:', e);
        addMessage('⚠️ DataChannel 오류가 발생했습니다.', 'system');
      };

      dc.onmessage = (e: MessageEvent<string>) => {
        addMessage(e.data, 'peer');
      };
    },
    [addMessage],
  );

  const createPeerConnection = useCallback((): RTCPeerConnection => {
    // 기존 연결 정리
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    iceCandidateQueueRef.current = [];

    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;

    pc.onicecandidate = (e) => {
      if (e.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({ type: 'ice-candidate', candidate: e.candidate }),
        );
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log('RTCPeerConnection 상태:', state);
      if (state === 'failed') {
        setStatus('disconnected');
        addMessage('❌ P2P 연결에 실패했습니다.', 'system');
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('ICE 연결 상태:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'disconnected') {
        addMessage('⚠️ 네트워크가 불안정합니다.', 'system');
      }
    };

    return pc;
  }, [addMessage]);

  // ICE 후보 큐 플러시
  const flushIceCandidateQueue = useCallback(async (pc: RTCPeerConnection) => {
    const queue = iceCandidateQueueRef.current.splice(0);
    for (const candidate of queue) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('ICE candidate 큐 플러시 실패:', err);
      }
    }
  }, []);

  // WebSocket 메시지 핸들러 설정
  const setupWsHandlers = useCallback(
    (ws: WebSocket) => {
      ws.onmessage = async (e: MessageEvent<string>) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(e.data) as Record<string, unknown>;
        } catch {
          return;
        }

        switch (msg.type) {
          // ── 방 생성 완료 (Host) ────────────────────────────
          case 'room-created': {
            setRoomId(msg.roomId as string);
            setStatus('waiting');
            setIsHost(true);
            addMessage(
              `🏠 방이 생성되었습니다. ID: ${msg.roomId as string}`,
              'system',
            );
            break;
          }

          // ── 방 입장 완료 (Guest) ───────────────────────────
          case 'room-joined': {
            setRoomId(msg.roomId as string);
            setStatus('connecting');
            setIsHost(false);
            addMessage(
              `🚪 방에 입장했습니다. 호스트의 연결을 기다리는 중...`,
              'system',
            );
            break;
          }

          // ── 게스트 입장 알림 → Host가 Offer 생성 ──────────
          case 'peer-joined': {
            setStatus('connecting');
            addMessage('👋 상대방이 입장했습니다. 연결 중...', 'system');

            const pc = createPeerConnection();

            // Host가 DataChannel을 만든다
            const dc = pc.createDataChannel('chat');
            setupDataChannel(dc);

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            ws.send(JSON.stringify({ type: 'offer', sdp: offer }));
            break;
          }

          // ── Offer 수신 (Guest) → Answer 생성 ──────────────
          case 'offer': {
            const pc = createPeerConnection();

            // Guest는 ondatachannel로 채널을 받는다
            pc.ondatachannel = (ev) => {
              setupDataChannel(ev.channel);
            };

            const remoteSdp = msg.sdp as RTCSessionDescriptionInit;
            await pc.setRemoteDescription(new RTCSessionDescription(remoteSdp));
            await flushIceCandidateQueue(pc);

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            ws.send(JSON.stringify({ type: 'answer', sdp: answer }));
            break;
          }

          // ── Answer 수신 (Host) ─────────────────────────────
          case 'answer': {
            const pc = pcRef.current;
            if (!pc) break;
            const remoteSdp = msg.sdp as RTCSessionDescriptionInit;
            await pc.setRemoteDescription(new RTCSessionDescription(remoteSdp));
            await flushIceCandidateQueue(pc);
            break;
          }

          // ── ICE Candidate 수신 ─────────────────────────────
          case 'ice-candidate': {
            const pc = pcRef.current;
            const candidate = msg.candidate as RTCIceCandidateInit | null;
            if (!candidate) break;

            if (pc?.remoteDescription) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
              } catch (err) {
                console.warn('ICE candidate 추가 실패:', err);
              }
            } else {
              // remote description 설정 전이면 큐에 저장
              iceCandidateQueueRef.current.push(candidate);
            }
            break;
          }

          // ── 오류 ───────────────────────────────────────────
          case 'error': {
            addMessage(`❌ 오류: ${msg.message as string}`, 'system');
            setStatus('idle');
            setRoomId(null);
            setIsHost(null);
            break;
          }

          // ── 상대방(guest) 연결 끊김 → host만 수신 ──────────
          case 'guest-left': {
            // P2P 자원 정리
            dcRef.current?.close();
            pcRef.current?.close();
            dcRef.current = null;
            pcRef.current = null;
            iceCandidateQueueRef.current = [];
            // roomId는 유지한 채 waiting 상태로 복귀
            setStatus('waiting');
            addMessage('👋 상대방이 방을 나갔습니다. 새 연결을 기다립니다.', 'system');
            break;
          }

          // ── host 연결 끊김 → guest만 수신 ────────────────
          case 'host-left': {
            // P2P/WebSocket 자원 정리
            dcRef.current?.close();
            pcRef.current?.close();
            dcRef.current = null;
            pcRef.current = null;
            iceCandidateQueueRef.current = [];
            // 방이 사라졌으므로 roomId 초기화
            setRoomId(null);
            setIsHost(null);
            setStatus('disconnected');
            addMessage('🚪 호스트가 방을 닫았습니다.', 'system');
            break;
          }
        }
      };

      ws.onclose = () => {
        console.log('시그널링 서버 연결 끊김');
      };

      ws.onerror = (err) => {
        console.error('WebSocket 오류:', err);
        addMessage('❌ 시그널링 서버에 연결할 수 없습니다.', 'system');
        setStatus('idle');
      };
    },
    [addMessage, createPeerConnection, setupDataChannel, flushIceCandidateQueue],
  );

  // WebSocket 초기화 (이전 연결 정리 포함)
  const initWebSocket = useCallback(
    (onOpen: (ws: WebSocket) => void): WebSocket => {
      // 기존 연결 정리
      if (wsRef.current) {
        wsRef.current.onclose = null; // 이벤트 핸들러 제거 후 닫기
        wsRef.current.close();
        wsRef.current = null;
      }
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      if (dcRef.current) {
        dcRef.current.close();
        dcRef.current = null;
      }

      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('시그널링 서버 연결됨');
        onOpen(ws);
      };

      setupWsHandlers(ws);
      return ws;
    },
    [setupWsHandlers],
  );

  // ── 공개 API ─────────────────────────────────────────────────

  const createRoom = useCallback(() => {
    setMessages([]);
    setStatus('creating');
    initWebSocket((ws) => {
      ws.send(JSON.stringify({ type: 'create-room' }));
    });
  }, [initWebSocket]);

  const joinRoom = useCallback(
    (id: string) => {
      const trimmed = id.trim().toUpperCase();
      if (!trimmed) return;

      setMessages([]);
      setStatus('joining');
      initWebSocket((ws) => {
        ws.send(JSON.stringify({ type: 'join-room', roomId: trimmed }));
      });
    },
    [initWebSocket],
  );

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (dcRef.current?.readyState === 'open') {
        dcRef.current.send(trimmed);
        addMessage(trimmed, 'me');
      } else {
        addMessage('⚠️ 연결이 없어 메시지를 전송할 수 없습니다.', 'system');
      }
    },
    [addMessage],
  );

  const disconnect = useCallback(() => {
    dcRef.current?.close();
    pcRef.current?.close();
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }
    dcRef.current = null;
    pcRef.current = null;
    wsRef.current = null;
    iceCandidateQueueRef.current = [];
    setStatus('idle');
    setRoomId(null);
    setIsHost(null);
    setMessages([]);
  }, []);

  const resetToLobby = useCallback(() => {
    setStatus('idle');
    setRoomId(null);
    setIsHost(null);
    // 메시지는 보존 (확인 가능하도록)
  }, []);

  // 언마운트 시 정리
  useEffect(() => {
    return () => {
      dcRef.current?.close();
      pcRef.current?.close();
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, []);

  return {
    status,
    roomId,
    messages,
    isHost,
    createRoom,
    joinRoom,
    sendMessage,
    disconnect,
    resetToLobby,
  };
}
