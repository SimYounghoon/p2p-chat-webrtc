import { useState, useRef, useCallback, useEffect } from 'react';
import { Message, ConnectionStatus } from '../types';

// ─── 상수 ─────────────────────────────────────────────────────

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

// ICE 수집 타임아웃 (ms) — 이 시간이 지나면 현재까지 수집된 후보로 진행
const ICE_TIMEOUT_MS = 8000;

// ─── 유틸 ─────────────────────────────────────────────────────

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

/**
 * RTCSessionDescriptionInit을 Base64 JSON 문자열로 인코딩합니다.
 * ICE gathering 완료 후 localDescription 전체를 담으므로
 * 별도 candidate 교환이 필요 없습니다.
 */
function encodeSignal(desc: RTCSessionDescriptionInit): string {
  return btoa(JSON.stringify(desc));
}

/**
 * Base64 문자열을 RTCSessionDescriptionInit으로 디코딩합니다.
 */
function decodeSignal(code: string): RTCSessionDescriptionInit {
  try {
    return JSON.parse(atob(code.trim())) as RTCSessionDescriptionInit;
  } catch {
    throw new Error('잘못된 코드 형식입니다. 코드를 다시 확인하세요.');
  }
}

/**
 * ICE gathering이 완료될 때까지 대기합니다.
 * 타임아웃 초과 시 현재까지 수집된 후보로 계속 진행합니다.
 */
function waitForIceComplete(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }

    const onStateChange = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', onStateChange);
        resolve();
      }
    };

    pc.addEventListener('icegatheringstatechange', onStateChange);

    // 타임아웃: 지정 시간 후 현재 상태로 진행
    setTimeout(() => {
      pc.removeEventListener('icegatheringstatechange', onStateChange);
      resolve();
    }, ICE_TIMEOUT_MS);
  });
}

// ─── 훅 ───────────────────────────────────────────────────────

export function useChat() {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isHost, setIsHost] = useState<boolean | null>(null);
  const [offerCode, setOfferCode] = useState<string | null>(null);
  const [answerCode, setAnswerCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);

  // ── 내부 헬퍼 ───────────────────────────────────────────────

  const addMessage = useCallback((text: string, sender: Message['sender']) => {
    setMessages((prev) => [
      ...prev,
      { id: generateId(), text, sender, timestamp: new Date() },
    ]);
  }, []);

  /** DataChannel 이벤트 핸들러 바인딩 */
  const setupDataChannel = useCallback(
    (dc: RTCDataChannel) => {
      dcRef.current = dc;

      dc.onopen = () => {
        setStatus('connected');
        addMessage('✅ 연결되었습니다! 채팅을 시작하세요.', 'system');
      };

      dc.onclose = () => {
        setStatus('disconnected');
        addMessage('🔌 연결이 끊어졌습니다.', 'system');
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

  /** RTCPeerConnection 및 DataChannel 자원 해제 */
  const cleanup = useCallback(() => {
    if (dcRef.current) {
      dcRef.current.onopen = null;
      dcRef.current.onclose = null;
      dcRef.current.onerror = null;
      dcRef.current.onmessage = null;
      try { dcRef.current.close(); } catch { /* 무시 */ }
      dcRef.current = null;
    }
    if (pcRef.current) {
      try { pcRef.current.close(); } catch { /* 무시 */ }
      pcRef.current = null;
    }
  }, []);

  // ── 공개 API ─────────────────────────────────────────────────

  /**
   * 호스트 역할: offer 생성 → ICE 수집 완료 → 연결 코드 반환
   */
  const startHost = useCallback(async () => {
    try {
      cleanup();
      setMessages([]);
      setError(null);
      setOfferCode(null);
      setAnswerCode(null);
      setStatus('gathering');
      setIsHost(true);

      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;

      // 호스트가 DataChannel을 생성
      const dc = pc.createDataChannel('chat');
      setupDataChannel(dc);

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        console.log('[WebRTC] connectionState:', state);
        if (state === 'failed') {
          setStatus('disconnected');
          setError('P2P 연결에 실패했습니다. 상대방의 코드를 다시 확인하세요.');
          addMessage('❌ P2P 연결에 실패했습니다.', 'system');
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log('[WebRTC] iceConnectionState:', pc.iceConnectionState);
        if (pc.iceConnectionState === 'disconnected') {
          addMessage('⚠️ 네트워크가 불안정합니다.', 'system');
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // ICE gathering 완료 대기 → localDescription에 모든 후보 포함됨
      await waitForIceComplete(pc);

      const code = encodeSignal(pc.localDescription!);
      setOfferCode(code);
      setStatus('offer-ready');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus('idle');
    }
  }, [cleanup, setupDataChannel, addMessage]);

  /**
   * 게스트 역할: offer 코드 수신 → answer 생성 → ICE 수집 완료 → 응답 코드 반환
   */
  const startGuest = useCallback(
    async (rawCode: string) => {
      try {
        cleanup();
        setMessages([]);
        setError(null);
        setOfferCode(null);
        setAnswerCode(null);
        setStatus('gathering');
        setIsHost(false);

        const offerDesc = decodeSignal(rawCode);
        if (offerDesc.type !== 'offer') {
          throw new Error('호스트 연결 코드가 아닙니다. A의 코드를 붙여넣으세요.');
        }

        const pc = new RTCPeerConnection(ICE_SERVERS);
        pcRef.current = pc;

        // 게스트는 ondatachannel로 채널을 받는다
        pc.ondatachannel = (ev) => {
          setupDataChannel(ev.channel);
        };

        pc.onconnectionstatechange = () => {
          const state = pc.connectionState;
          console.log('[WebRTC] connectionState:', state);
          if (state === 'failed') {
            setStatus('disconnected');
            setError('P2P 연결에 실패했습니다. 호스트 코드를 다시 확인하세요.');
            addMessage('❌ P2P 연결에 실패했습니다.', 'system');
          }
        };

        pc.oniceconnectionstatechange = () => {
          console.log('[WebRTC] iceConnectionState:', pc.iceConnectionState);
          if (pc.iceConnectionState === 'disconnected') {
            addMessage('⚠️ 네트워크가 불안정합니다.', 'system');
          }
        };

        await pc.setRemoteDescription(new RTCSessionDescription(offerDesc));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        // ICE gathering 완료 대기
        await waitForIceComplete(pc);

        const code = encodeSignal(pc.localDescription!);
        setAnswerCode(code);
        setStatus('answer-ready');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setStatus('idle');
      }
    },
    [cleanup, setupDataChannel, addMessage],
  );

  /**
   * 호스트 역할: 게스트의 answer 코드를 수신해 연결 완료
   */
  const completeConnection = useCallback(async (rawCode: string) => {
    try {
      setError(null);
      const answerDesc = decodeSignal(rawCode);
      if (answerDesc.type !== 'answer') {
        throw new Error('게스트 응답 코드가 아닙니다. B의 코드를 붙여넣으세요.');
      }

      const pc = pcRef.current;
      if (!pc) throw new Error('연결이 초기화되지 않았습니다. 처음부터 다시 시도하세요.');

      await pc.setRemoteDescription(new RTCSessionDescription(answerDesc));
      setStatus('connecting');
      addMessage('⏳ B의 코드가 적용되었습니다. DataChannel 연결을 기다리는 중...', 'system');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  }, [addMessage]);

  /** 메시지 전송 */
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

  /** 전체 초기화 (로비로 복귀) */
  const reset = useCallback(() => {
    cleanup();
    setStatus('idle');
    setMessages([]);
    setIsHost(null);
    setOfferCode(null);
    setAnswerCode(null);
    setError(null);
  }, [cleanup]);

  // 언마운트 시 자원 정리
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    status,
    messages,
    isHost,
    offerCode,
    answerCode,
    error,
    startHost,
    startGuest,
    completeConnection,
    sendMessage,
    reset,
  };
}
