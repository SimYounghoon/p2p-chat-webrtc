import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';

// ─── 타입 정의 ────────────────────────────────────────────────

interface Room {
  host: WebSocket;
  guest?: WebSocket;
}

// 서버가 그대로 포워딩하는 메시지들 (sdp/candidate 내용은 그대로 전달)
interface BaseMsg {
  type: string;
  [key: string]: unknown;
}

// ─── 앱 초기화 ────────────────────────────────────────────────

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// 메모리 기반 방 관리
const rooms = new Map<string, Room>();
// 클라이언트 → 방 ID 역색인
const clientRooms = new Map<WebSocket, string>();

// ─── 유틸 ────────────────────────────────────────────────────

function generateRoomId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 혼동 문자 제외
  let id: string;
  do {
    id = Array.from({ length: 6 }, () =>
      chars[Math.floor(Math.random() * chars.length)],
    ).join('');
  } while (rooms.has(id));
  return id;
}

function safeSend(ws: WebSocket, data: object): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

/**
 * 클라이언트 연결 종료 시 방 정리 및 상대방에게 알림.
 *
 * - host 퇴장: 방을 삭제하고 guest에게 'host-left' 전송 (guest는 대화 종료 처리)
 * - guest 퇴장: 방은 유지하고 host에게 'guest-left' 전송 (host는 waiting 상태로 복귀)
 */
function cleanupClient(ws: WebSocket): void {
  const roomId = clientRooms.get(ws);
  if (!roomId) return;

  const room = rooms.get(roomId);
  clientRooms.delete(ws);

  if (!room) return;

  if (room.host === ws) {
    // ── host 퇴장: 방 전체 삭제 ──────────────────────────
    rooms.delete(roomId);
    if (room.guest) {
      clientRooms.delete(room.guest);
      safeSend(room.guest, { type: 'host-left' });
    }
    console.log(`[Room ${roomId}] 삭제됨 (host 퇴장)`);
  } else {
    // ── guest 퇴장: 방은 유지, guest 슬롯만 비움 ─────────
    room.guest = undefined;
    safeSend(room.host, { type: 'guest-left' });
    console.log(`[Room ${roomId}] guest 퇴장, host 대기 중`);
  }
}

// ─── WebSocket 핸들러 ─────────────────────────────────────────

wss.on('connection', (ws: WebSocket) => {
  console.log(`클라이언트 연결됨 (총 ${wss.clients.size}명)`);

  ws.on('message', (raw) => {
    let msg: BaseMsg;
    try {
      msg = JSON.parse(raw.toString()) as BaseMsg;
    } catch {
      return;
    }

    switch (msg.type) {
      // ── 방 생성 ──────────────────────────────────────────
      case 'create-room': {
        // 기존에 참여 중인 방이 있으면 먼저 정리
        cleanupClient(ws);

        const roomId = generateRoomId();
        rooms.set(roomId, { host: ws });
        clientRooms.set(ws, roomId);

        safeSend(ws, { type: 'room-created', roomId });
        console.log(`[Room ${roomId}] 생성됨 (host)`);
        break;
      }

      // ── 방 입장 ──────────────────────────────────────────
      case 'join-room': {
        const rawId = msg.roomId;
        if (typeof rawId !== 'string' || !rawId.trim()) {
          safeSend(ws, { type: 'error', message: '유효하지 않은 방 ID입니다.' });
          return;
        }

        const roomId = rawId.trim().toUpperCase();
        const room = rooms.get(roomId);

        if (!room) {
          safeSend(ws, { type: 'error', message: '존재하지 않는 방입니다.' });
          return;
        }
        if (room.guest) {
          safeSend(ws, { type: 'error', message: '이미 가득 찬 방입니다. (최대 2명)' });
          return;
        }
        if (room.host === ws) {
          safeSend(ws, { type: 'error', message: '자신이 만든 방에 입장할 수 없습니다.' });
          return;
        }

        // 기존 참여 방 정리 (다른 방에 있었을 경우)
        cleanupClient(ws);

        // 재조회 (cleanupClient 가 같은 방을 삭제할 수도 있으므로)
        const freshRoom = rooms.get(roomId);
        if (!freshRoom) {
          safeSend(ws, { type: 'error', message: '방 정보를 읽는 중 오류가 발생했습니다. 다시 시도해주세요.' });
          return;
        }

        freshRoom.guest = ws;
        clientRooms.set(ws, roomId);

        safeSend(ws, { type: 'room-joined', roomId });
        safeSend(freshRoom.host, { type: 'peer-joined' });
        console.log(`[Room ${roomId}] 게스트 입장`);
        break;
      }

      // ── WebRTC 시그널링 메시지 포워딩 ────────────────────
      case 'offer':
      case 'answer':
      case 'ice-candidate': {
        const roomId = clientRooms.get(ws);
        if (!roomId) return;

        const room = rooms.get(roomId);
        if (!room) return;

        const peer = room.host === ws ? room.guest : room.host;
        if (peer) safeSend(peer, msg);
        break;
      }

      default:
        console.warn(`알 수 없는 메시지 타입: ${msg.type}`);
    }
  });

  ws.on('close', () => {
    console.log(`클라이언트 연결 끊김 (남은 ${wss.clients.size}명)`);
    cleanupClient(ws);
  });

  ws.on('error', (err) => {
    console.error('WebSocket 오류:', err.message);
  });
});

// ─── 정적 파일 서빙 (프로덕션) ───────────────────────────────

const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// ─── 서버 시작 ────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 3001;

server.listen(PORT, () => {
  console.log(`\n🚀 P2P 채팅 서버 실행 중`);
  console.log(`   HTTP : http://localhost:${PORT}`);
  console.log(`   WS   : ws://localhost:${PORT}/ws\n`);
});
