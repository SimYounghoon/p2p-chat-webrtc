# P2P 채팅 — 암호화된 초대 링크 WebRTC

## 프로젝트 상태

이 프로젝트는 **실험 종료 / 보관(archived) 상태**입니다.

- 새로운 기능 개발을 중단합니다.
- 보안 업데이트와 호환성 대응을 더 이상 보장하지 않습니다.
- 학습/실험 목적 외 사용을 권장하지 않습니다.

외부 시그널링 서버 없이 브라우저끼리 **암호화된 초대 링크 + 응답 코드 1회 교환**으로 WebRTC DataChannel 1:1 채팅을 수립하는 앱입니다.

- 초대 링크: SDP JSON을 **deflate-raw 압축 후** AES-GCM + PBKDF2(SHA-256) 으로 암호화 → payload 약 70% 단축
- 응답 코드: 동일 방식(압축 → 암호화)으로 answer SDP 처리
- UI에 IP 직접 노출 없음

## 스택

| 영역 | 기술 |
|------|------|
| 프런트엔드 | React + TypeScript + Vite |
| P2P 통신 | WebRTC DataChannel (DTLS 암호화) |
| 시그널링 | **수동 코드 교환** (서버 없음) |
| 암호화 | Web Crypto API — AES-GCM 256-bit + PBKDF2-SHA256 + deflate-raw 압축 |
| 스타일 | Plain CSS (Slack 스타일) |

## 프로젝트 구조

```
project_test/
├── src/
│   ├── lib/
│   │   └── crypto.ts     # 압축(deflate-raw) + AES-GCM 암호화 유틸 (encryptText / decryptText)
│   ├── hooks/
│   │   └── useChat.ts    # WebRTC 수동 시그널링 훅
│   ├── types/
│   │   └── index.ts      # 공통 타입 정의
│   ├── App.tsx           # 시그널링 단계 UI + 채팅 UI
│   ├── App.css           # Slack 스타일 CSS
│   └── main.tsx          # 앱 엔트리포인트
├── index.html
├── vite.config.ts
└── package.json
```

## 실행 방법

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 프로덕션 빌드 → dist/
```

## 사용 방법 (새 흐름)

### A (호스트) 흐름

1. 페이지 접속 (URL에 `#invite=` 없을 때 호스트 화면이 뜸)
2. **암호문구** 입력 (게스트에게 별도로 알려줄 비밀 문구)
3. **"호스트 시작 — 초대 링크 생성"** 클릭
4. ICE 수집 완료 후 **암호화된 초대 링크** 자동 생성
5. **"🔗 초대 링크 복사"** → 게스트(B)에게 링크 + 암호문구 전달
6. B에게 받은 **응답 코드** 를 붙여넣기
7. **"✅ 연결 완료"** 클릭 → DataChannel 오픈 → 채팅 시작

> 💡 암호문구를 변경하면 새 초대 링크가 자동 생성됩니다.

### B (게스트) 흐름

1. A에게 받은 **초대 링크** 로 브라우저 접속
2. "초대 링크가 감지되었습니다" 화면에서 **암호문구** 입력
3. **"🔗 참가 연결"** 클릭 → offer 복호화 + answer 생성
4. **"📋 응답 코드 복사"** → A에게 전달 (1회)
5. A가 코드를 붙여넣으면 **자동으로 연결** 됨

## 동작 원리

```
[브라우저 A (호스트)]                          [브라우저 B (게스트)]
        │                                              │
        │  암호문구 입력 → 호스트 시작                    │
        │  createOffer() + ICE gathering 완료           │
        │  encryptText(offerSDP, passphrase)           │
        │  ① JSON 직렬화 → deflate-raw 압축            │
        │  ② AES-GCM 암호화 → base64url (z2:prefix)   │
        │  → /#invite=z2:<base64url> 링크 생성         │
        │                                              │
        │  ── 초대 링크 공유 (링크 + 암호문구 전달) ──────▶│
        │                                              │  암호문구 입력
        │                                              │  decryptText(payload, passphrase)
        │                                              │  setRemoteDescription(offer)
        │                                              │  createAnswer() + ICE gathering
        │                                              │  encryptText(answerSDP, passphrase)
        │                                              │  → 응답 코드 생성
        │◀─ 응답 코드 전달 (1회 복사·붙여넣기) ──────────│
        │  decryptText(answerCode, passphrase)         │
        │  setRemoteDescription(answer)               │
        │                                              │
        │◀═══════════ DataChannel 직접 통신 ════════════│
```

## 암호화 구조

- **압축**: `CompressionStream('deflate-raw')` — 평문(SDP JSON)을 먼저 압축하여 payload 크기를 줄임
- **키 파생**: PBKDF2 (iterations: 100,000, hash: SHA-256)
- **암호화**: AES-GCM 256-bit
- **직렬화**: `salt(16B) ‖ iv(12B) ‖ ciphertext(compressed)` → `z2:<base64url>`
- **버전 prefix**: `z2:` — 구형(비압축) payload와 구별, 하위 호환 유지
- **잘못된 암호문구**: AES-GCM 인증 태그 불일치 → 즉시 오류 메시지

### payload 길이 비교

| 단계 | 구형 (v1) | 신형 (v2) |
|------|-----------|-----------|
| 시그널링 원문 | `JSON.stringify(sdp)` ~2,000자 | 동일 |
| 직렬화 | `btoa(JSON)` ~2,700자 | JSON 직접 사용 |
| 압축 후 | — | deflate-raw ~700 bytes |
| 암호화 후 | ~2,728 bytes | ~728 bytes |
| 최종 base64url | **~3,640자** | **~975자** (약 73% 감소) |

## 보안

- WebRTC DataChannel은 **DTLS 1.2 암호화** 로 전송 계층을 보호합니다.
- 초대 링크(offer SDP)와 응답 코드(answer SDP)가 모두 암호화되어 IP 등 민감 정보를 보호합니다.
- 메시지는 브라우저 간 직접 전달되며, 어떤 서버도 거치지 않습니다.

## 종료 시점 기준 치명적 주의사항

아래 항목들은 이 프로젝트를 실제 서비스로 사용하기 어렵게 만드는 **구조적/보안상 핵심 한계**입니다.

1. **상대 피어에게 실제 IP가 노출될 수 있습니다.**  
   UI에는 표시하지 않더라도 WebRTC P2P 연결 과정에서 네트워크 정보가 상대 피어에게 전달될 수 있습니다. 익명성이 필요한 용도로 사용하면 안 됩니다.

2. **상대 신원을 검증할 방법이 없습니다.**  
   초대 링크와 암호문구를 가진 사람은 누구나 참여할 수 있습니다. 링크 전달 과정에서 제3자가 끼어들어도 앱 내부에서 진짜 상대인지 확인할 수 없습니다.

3. **암호문구 강도에 보안이 크게 의존합니다.**  
   짧거나 추측 가능한 암호문구를 쓰면 초대 payload 및 응답 코드를 보호하는 의미가 약해집니다. 별도 안전 채널로 길고 복잡한 암호문구를 전달해야 합니다.

4. **TURN 서버가 없어 연결 안정성이 보장되지 않습니다.**  
   엄격한 NAT, 회사망, 일부 모바일/공용망 환경에서는 연결 자체가 실패할 수 있습니다. 즉, 외부망에서 항상 동작하는 서비스로 볼 수 없습니다.

5. **관리·차단·감사 기능이 없습니다.**  
   서버가 없기 때문에 사용자 차단, 강제 종료, 사용 기록 감사, 악성 행위 대응이 불가능합니다. 문제가 생겨도 운영 측에서 개입할 수 없습니다.

6. **보관 상태이므로 향후 취약점 대응이 없습니다.**  
   브라우저/WebRTC/의존성 변화로 새로운 취약점이나 호환성 문제가 생겨도 패치를 제공하지 않습니다.

## 한계점

| 항목 | 설명 |
|------|------|
| TURN 서버 없음 | 엄격한 대칭 NAT 환경에서는 P2P 연결이 실패할 수 있습니다 |
| 암호문구 대역외 전달 필요 | 초대 링크와 별도로 암호문구를 안전하게 공유해야 합니다 |
| 재연결 없음 | 연결 끊기면 처음부터 링크를 다시 교환해야 합니다 |

## 배포

서버가 필요 없으므로 정적 호스팅으로 배포 가능합니다.

```bash
npm run build
# dist/ 폴더를 원하는 호스팅 서비스에 업로드
```

> ⚠️ `/#invite=...` hash URL이 작동하려면 호스팅 서비스가 SPA 라우팅을 지원해야 합니다 (또는 hash-based routing이므로 서버 설정 불필요).
