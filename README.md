# P2P 채팅 웹앱

WebRTC DataChannel 기반 1:1 P2P 채팅 앱입니다.  
서버는 WebSocket 시그널링만 담당하고, 채팅 데이터는 피어 간에 직접 전송됩니다.

## 스택

| 영역 | 기술 |
|------|------|
| 프런트엔드 | React + TypeScript + Vite |
| 백엔드 | Node.js + Express + ws |
| 스타일 | Plain CSS (Slack 스타일) |
| P2P | WebRTC DataChannel |

## 프로젝트 구조

```
project_test/
├── server/
│   └── index.ts          # Express + WebSocket 시그널링 서버
├── src/
│   ├── hooks/
│   │   └── useChat.ts    # WebRTC + 시그널링 통합 훅
│   ├── types/
│   │   └── index.ts      # 공통 타입 정의
│   ├── App.tsx           # 메인 컴포넌트 (UI 포함)
│   ├── App.css           # Slack 스타일 CSS
│   └── main.tsx          # 앱 엔트리포인트
├── index.html
├── vite.config.ts
├── tsconfig.json         # 프런트엔드용
├── tsconfig.node.json    # Vite 설정용
├── tsconfig.server.json  # 서버 빌드용
└── package.json
```

## 실행 방법

### 1. 의존성 설치

```bash
npm install
```

### 2. 개발 서버 실행

```bash
npm run dev
```

- 프런트엔드: http://localhost:5173
- 시그널링 서버: http://localhost:3001
- Vite가 `/ws` 경로를 서버로 자동 프록시

### 3. 프로덕션 빌드 & 실행

```bash
npm run build    # Vite 빌드 + 서버 TypeScript 컴파일
npm start        # 포트 3001에서 서버 시작 (프런트 정적 파일 포함)
```

브라우저에서 http://localhost:3001 접속

## 사용 방법

1. **사용자 A** : "방 만들기" 클릭 → 6자리 방 ID 확인
2. **방 ID 공유** : "📋 복사" 버튼으로 방 ID를 상대방에게 전달
3. **사용자 B** : 방 ID를 입력창에 붙여넣고 "참여하기" 클릭
4. P2P 연결이 수립되면 채팅 시작
5. 사이드바 "🚪 나가기" 또는 창 닫기로 종료

## 동작 원리

```
[사용자 A]          [시그널링 서버]          [사용자 B]
   │                      │                      │
   │── create-room ───────▶│                      │
   │◀─ room-created ───────│                      │
   │                      │                      │
   │                      │◀─ join-room ──────────│
   │◀─ peer-joined ────────│── room-joined ───────▶│
   │                      │                      │
   │── offer (SDP) ────────▶── offer ────────────▶│
   │◀─ answer (SDP) ───────│◀─ answer ─────────────│
   │── ICE candidates ─────▶── ICE ─────────────▶│
   │◀─ ICE candidates ─────│◀─ ICE ────────────────│
   │                      │                      │
   │◀══════════════ DataChannel 직접 통신 ══════════│
```

## 주의 사항

- 방은 서버 메모리에만 저장되므로 서버 재시작 시 모두 삭제됩니다.
- 1:1만 지원. 이미 2명인 방은 입장 거절됩니다.
- STUN 서버는 Google 공개 서버를 사용합니다. 같은 NAT 환경에서는 직접 연결, 다른 네트워크에서는 STUN을 통해 연결됩니다.
- TURN 서버가 없어 일부 엄격한 NAT 환경에서는 연결이 실패할 수 있습니다.

## 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `PORT` | `3001` | 서버 포트 |

## Render 배포

이 프로젝트는 `render.yaml`이 포함되어 있어 Render Blueprint 배포가 가능합니다.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/SimYounghoon/p2p-chat-webrtc)

- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- 공개 URL 한 개로 웹앱과 WebSocket 시그널링 서버를 함께 제공합니다.

주의:

- 이 앱은 사용자의 개인 IP를 레포지토리에 저장하지 않습니다.
- 실제 접속은 Render가 제공하는 공개 도메인을 사용합니다.
- TURN 서버는 포함되어 있지 않아 일부 네트워크에서는 P2P 연결이 실패할 수 있습니다.
