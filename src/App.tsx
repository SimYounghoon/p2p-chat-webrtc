import { useState, useRef, useEffect, useCallback } from 'react';
import { useChat } from './hooks/useChat';
import { ConnectionStatus, Message } from './types';
import { encryptText, decryptText } from './lib/crypto';

// ─── 유틸 함수 ──────────────────────────────────────────────────

function formatTime(date: Date): string {
  return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function statusLabel(status: ConnectionStatus): string {
  switch (status) {
    case 'idle':         return '대기 중';
    case 'gathering':   return '코드 생성 중...';
    case 'offer-ready': return '응답 코드 대기 중';
    case 'answer-ready':return '호스트 붙여넣기 대기';
    case 'connecting':  return 'P2P 연결 중...';
    case 'connected':   return '연결됨 🔒';
    case 'disconnected':return '연결 끊김';
    default:            return '';
  }
}

function statusDotClass(status: ConnectionStatus): string {
  if (status === 'connected')    return 'status-dot status-dot--online';
  if (status === 'disconnected') return 'status-dot status-dot--offline';
  if (['gathering', 'offer-ready', 'answer-ready', 'connecting'].includes(status))
    return 'status-dot status-dot--busy';
  return 'status-dot status-dot--idle';
}

/** URL hash から invite payload を抽出 */
function extractInvitePayload(): string | null {
  const match = window.location.hash.match(/^#invite=(.+)$/);
  return match ? match[1] : null;
}

// ─── CopyButton ─────────────────────────────────────────────────

interface CopyButtonProps {
  text: string;
  label?: string;
  className?: string;
}

function CopyButton({ text, label = '📋 복사', className = 'btn btn--copy' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button className={className} onClick={handleCopy}>
      {copied ? '✅ 복사됨' : label}
    </button>
  );
}

// ─── Sidebar ────────────────────────────────────────────────────

interface SidebarProps {
  status: ConnectionStatus;
  isHost: boolean | null;
  onReset: () => void;
}

function Sidebar({ status, isHost, onReset }: SidebarProps) {
  const isActive = status !== 'idle';
  return (
    <aside className="sidebar">
      <div className="sidebar__header">
        <div className="sidebar__workspace-name">
          <span className="sidebar__logo">💬</span>
          <span>P2P 채팅</span>
        </div>
      </div>

      <nav className="sidebar__nav">
        <div className="sidebar__section-label">채널</div>

        <div className={`sidebar__item ${isActive ? 'sidebar__item--active' : ''}`}>
          <span className="sidebar__item-icon">#</span>
          <span>채팅방</span>
        </div>

        {isHost !== null && (
          <div className="sidebar__room-info">
            <div className="sidebar__room-id-label">역할</div>
            <div className="sidebar__room-id-value" style={{ fontSize: '14px', letterSpacing: '0' }}>
              {isHost ? '👑 호스트 (A)' : '🙋 게스트 (B)'}
            </div>
          </div>
        )}

        <div className="sidebar__section-label sidebar__section-label--top">상태</div>
        <div className="sidebar__status">
          <span className={statusDotClass(status)} />
          <span className="sidebar__status-text">{statusLabel(status)}</span>
        </div>

        <div className="sidebar__section-label sidebar__section-label--top">보안</div>
        <div className="sidebar__status" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px', padding: '4px 16px' }}>
          <span className="sidebar__status-text" style={{ fontSize: '11px', lineHeight: '1.5' }}>
            🔐 WebRTC DTLS 암호화
          </span>
          <span className="sidebar__status-text" style={{ fontSize: '11px', lineHeight: '1.5' }}>
            🛡️ 초대 링크 AES-GCM 암호화
          </span>
          <span className="sidebar__status-text" style={{ fontSize: '11px', lineHeight: '1.5' }}>
            🚫 서버 미경유 직접 전송
          </span>
        </div>
      </nav>

      {isActive && (
        <div className="sidebar__footer">
          <button className="sidebar__disconnect-btn" onClick={onReset}>
            🔄 초기화 / 나가기
          </button>
        </div>
      )}
    </aside>
  );
}

// ─── PassphraseInput ─────────────────────────────────────────────

interface PassphraseInputProps {
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  placeholder?: string;
  label?: string;
  hint?: string;
  readOnly?: boolean;
}

function PassphraseInput({
  value, onChange, onEnter,
  placeholder = '암호문구를 입력하세요...',
  label = '🔑 암호문구',
  hint,
  readOnly = false,
}: PassphraseInputProps) {
  return (
    <div className="lobby__section">
      <label className="lobby__section-title">{label}</label>
      <input
        className="input input--full"
        type={readOnly ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) onEnter(); }}
        autoComplete="off"
      />
      {hint && <p className="lobby__section-hint">{hint}</p>}
    </div>
  );
}

// ─── ManualSignaling ────────────────────────────────────────────

interface ManualSignalingProps {
  status: ConnectionStatus;
  isHost: boolean | null;
  offerCode: string | null;
  answerCode: string | null;
  error: string | null;
  onStartHost: () => void;
  onStartGuest: (rawOffer: string) => void;
  onCompleteConnection: (rawAnswer: string) => void;
  onReset: () => void;
  invitePayload: string | null;
}

function ManualSignaling({
  status,
  isHost,
  offerCode,
  answerCode,
  error,
  onStartHost,
  onStartGuest,
  onCompleteConnection,
  onReset,
  invitePayload,
}: ManualSignalingProps) {
  const [passphrase, setPassphrase] = useState('');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [encryptedAnswerCode, setEncryptedAnswerCode] = useState<string | null>(null);
  const [cryptoError, setCryptoError] = useState<string | null>(null);
  const [hostAnswerInput, setHostAnswerInput] = useState('');
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);

  const combinedError = cryptoError ?? error;

  // ── 호스트: offerCode 또는 암호문구 변경 시 초대 링크 재생성 ──
  useEffect(() => {
    if (!offerCode || !isHost || !passphrase.trim()) {
      setInviteLink(null);
      return;
    }
    setIsGeneratingLink(true);
    encryptText(offerCode, passphrase.trim())
      .then((enc) => {
        setInviteLink(`${window.location.origin}/#invite=${enc}`);
        setIsGeneratingLink(false);
      })
      .catch(() => {
        setCryptoError('링크 생성 중 오류가 발생했습니다.');
        setIsGeneratingLink(false);
      });
  }, [offerCode, passphrase, isHost]);

  // ── 게스트: answerCode 준비 시 암호화된 응답 코드 생성 ──
  useEffect(() => {
    if (!answerCode || isHost || !passphrase.trim()) {
      setEncryptedAnswerCode(null);
      return;
    }
    encryptText(answerCode, passphrase.trim())
      .then((enc) => setEncryptedAnswerCode(enc))
      .catch(() => setCryptoError('응답 코드 암호화 중 오류가 발생했습니다.'));
  }, [answerCode, passphrase, isHost]);

  // ── 핸들러 ─────────────────────────────────────────────────────

  const handleStartHost = () => {
    if (!passphrase.trim()) {
      setCryptoError('암호문구를 입력해주세요.');
      return;
    }
    setCryptoError(null);
    onStartHost();
  };

  const handleStartGuest = async () => {
    if (!passphrase.trim()) {
      setCryptoError('암호문구를 입력해주세요.');
      return;
    }
    if (!invitePayload) {
      setCryptoError('초대 링크 정보가 없습니다.');
      return;
    }
    try {
      setCryptoError(null);
      const rawOffer = await decryptText(invitePayload, passphrase.trim());
      onStartGuest(rawOffer);
    } catch (e) {
      setCryptoError(e instanceof Error ? e.message : '복호화 중 오류가 발생했습니다.');
    }
  };

  const handleCompleteConnection = async () => {
    if (!hostAnswerInput.trim() || !passphrase.trim()) return;
    try {
      setCryptoError(null);
      const rawAnswer = await decryptText(hostAnswerInput.trim(), passphrase.trim());
      onCompleteConnection(rawAnswer);
    } catch (e) {
      setCryptoError(e instanceof Error ? e.message : '복호화 중 오류가 발생했습니다.');
    }
  };

  // ── ICE 수집 중 ──────────────────────────────────────────────
  if (status === 'gathering') {
    return (
      <div className="lobby">
        <div className="lobby__card">
          <div className="signal-step">
            <div className="signal-step__spinner">
              <span className="spinner spinner--large spinner--dark" />
            </div>
            <h2 className="signal-step__title">
              {isHost ? '초대 링크 생성 중...' : '응답 코드 생성 중...'}
            </h2>
            <p className="signal-step__desc">
              ICE 후보를 수집하고 있습니다. 최대 8초 소요됩니다.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── 게스트: 초대 링크 접속 화면 ─────────────────────────────
  if (status === 'idle' && invitePayload !== null) {
    return (
      <div className="lobby">
        <div className="lobby__card">
          <div className="lobby__title">
            <span className="lobby__title-icon">🔗</span>
            <h1>초대 참가</h1>
          </div>
          <p className="lobby__subtitle">암호화된 초대 링크로 접속하셨습니다.</p>

          <div className="lobby__invite-notice">
            ✅ 초대 링크가 감지되었습니다. 호스트에게 받은 암호문구를 입력하고 연결을 시작하세요.
          </div>

          {combinedError && <div className="lobby__error">{combinedError}</div>}

          <PassphraseInput
            value={passphrase}
            onChange={(v) => { setPassphrase(v); setCryptoError(null); }}
            onEnter={handleStartGuest}
            placeholder="호스트에게 받은 암호문구..."
            label="🔑 암호문구 입력"
            hint="호스트와 동일한 암호문구를 입력하세요. 틀리면 복호화 오류가 발생합니다."
          />

          <button
            className="btn btn--primary btn--full"
            onClick={handleStartGuest}
            disabled={!passphrase.trim()}
          >
            🔗 참가 연결
          </button>
        </div>
      </div>
    );
  }

  // ── 호스트: 시작 화면 ───────────────────────────────────────
  if (status === 'idle') {
    return (
      <div className="lobby">
        <div className="lobby__card">
          <div className="lobby__title">
            <span className="lobby__title-icon">💬</span>
            <h1>P2P 채팅</h1>
          </div>
          <p className="lobby__subtitle">서버 없는 수동 시그널링 WebRTC 1:1 채팅</p>

          <div className="lobby__info-box">
            <strong>연결 방법:</strong> 암호문구로 보호된 초대 링크를 생성해 게스트에게 전달합니다.
            게스트는 링크로 접속한 뒤 암호문구를 입력하고, 응답 코드 1회 전달로 연결이 완료됩니다.
          </div>

          {combinedError && <div className="lobby__error">{combinedError}</div>}

          <PassphraseInput
            value={passphrase}
            onChange={(v) => { setPassphrase(v); setCryptoError(null); }}
            onEnter={handleStartHost}
            placeholder="암호문구를 설정하세요..."
            label="🔑 암호문구 설정"
            hint="이 암호문구로 초대 링크를 암호화합니다. 링크와 함께 게스트에게 별도로 전달하세요."
          />

          <button
            className="btn btn--primary btn--full"
            onClick={handleStartHost}
            disabled={!passphrase.trim()}
          >
            🏠 호스트 시작 — 초대 링크 생성
          </button>
        </div>
      </div>
    );
  }

  // ── 호스트: offer 준비 완료 ─────────────────────────────────
  if (status === 'offer-ready' && isHost) {
    return (
      <div className="lobby">
        <div className="lobby__card lobby__card--wide">
          <div className="signal-step__header">
            <span className="signal-step__badge signal-step__badge--host">호스트 (A)</span>
            <h2 className="signal-step__title signal-step__title--inline">초대 링크 생성 완료</h2>
          </div>

          {combinedError && <div className="lobby__error">{combinedError}</div>}

          {/* 암호문구 (변경하면 링크 자동 재생성) */}
          <div className="signal-box">
            <div className="signal-box__label">
              <span className="signal-box__num">🔑</span>
              암호문구 (변경 시 새 링크 자동 생성)
            </div>
            <input
              className="input input--full"
              type="text"
              value={passphrase}
              onChange={(e) => { setPassphrase(e.target.value); setCryptoError(null); }}
              placeholder="암호문구..."
              autoComplete="off"
            />
            <p className="lobby__section-hint" style={{ marginTop: '6px' }}>
              게스트에게 이 암호문구를 별도로 알려주세요 (링크와 함께).
            </p>
          </div>

          {/* Step 1: 초대 링크 복사 */}
          <div className="signal-box">
            <div className="signal-box__label">
              <span className="signal-box__num">1</span>
              초대 링크를 복사해 게스트(B)에게 전달하세요
            </div>
            {!passphrase.trim() ? (
              <p className="lobby__section-hint">암호문구를 입력해야 링크가 생성됩니다.</p>
            ) : isGeneratingLink ? (
              <div className="signal-waiting">
                <span className="spinner spinner--small spinner--dark" />
                링크 생성 중...
              </div>
            ) : inviteLink ? (
              <>
                <textarea
                  className="signal-textarea signal-textarea--readonly"
                  readOnly
                  value={inviteLink}
                  rows={3}
                  onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                />
                <CopyButton
                  text={inviteLink}
                  label="🔗 초대 링크 복사"
                  className="btn btn--primary btn--full"
                />
              </>
            ) : null}
          </div>

          {/* Step 2: 응답 코드 붙여넣기 */}
          <div className="signal-box">
            <div className="signal-box__label">
              <span className="signal-box__num">2</span>
              B에게 받은 응답 코드를 붙여넣고 연결을 완료하세요
            </div>
            <textarea
              className="signal-textarea"
              placeholder="게스트(B)가 보내준 응답 코드를 여기에 붙여넣으세요..."
              value={hostAnswerInput}
              onChange={(e) => setHostAnswerInput(e.target.value)}
              rows={4}
            />
            <div className="lobby__btn-row">
              <button className="btn btn--secondary" onClick={onReset}>
                🔄 처음부터
              </button>
              <button
                className="btn btn--primary"
                onClick={handleCompleteConnection}
                disabled={!hostAnswerInput.trim() || !passphrase.trim()}
              >
                ✅ 연결 완료
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 게스트: answer 준비 완료 ────────────────────────────────
  if (status === 'answer-ready' && !isHost) {
    return (
      <div className="lobby">
        <div className="lobby__card lobby__card--wide">
          <div className="signal-step__header">
            <span className="signal-step__badge signal-step__badge--guest">게스트 (B)</span>
            <h2 className="signal-step__title signal-step__title--inline">응답 코드 생성 완료</h2>
          </div>

          <div className="signal-box">
            <div className="signal-box__label">
              <span className="signal-box__num">✓</span>
              아래 응답 코드를 복사해 A에게 전달하세요 (1회)
            </div>
            {encryptedAnswerCode ? (
              <>
                <textarea
                  className="signal-textarea signal-textarea--readonly"
                  readOnly
                  value={encryptedAnswerCode}
                  rows={4}
                  onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                />
                <CopyButton
                  text={encryptedAnswerCode}
                  label="📋 응답 코드 복사"
                  className="btn btn--primary btn--full"
                />
              </>
            ) : (
              <div className="signal-waiting">
                <span className="spinner spinner--small spinner--dark" />
                응답 코드 암호화 중...
              </div>
            )}
          </div>

          <div className="signal-waiting">
            <span className="spinner spinner--small spinner--dark" />
            A가 응답 코드를 붙여넣으면 자동으로 연결됩니다...
          </div>

          <button className="btn btn--ghost btn--full" onClick={onReset}>
            🔄 처음부터
          </button>
        </div>
      </div>
    );
  }

  // ── 연결 중 ─────────────────────────────────────────────────
  if (status === 'connecting') {
    return (
      <div className="lobby">
        <div className="lobby__card">
          <div className="signal-step">
            <div className="signal-step__spinner">
              <span className="spinner spinner--large spinner--dark" />
            </div>
            <h2 className="signal-step__title">P2P 연결 중...</h2>
            <p className="signal-step__desc">
              DataChannel을 열고 있습니다. 잠시만 기다려주세요.
            </p>
            <button className="btn btn--ghost" onClick={onReset} style={{ marginTop: '16px' }}>
              🔄 취소 / 처음부터
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// ─── MessageList ────────────────────────────────────────────────

interface MessageListProps {
  messages: Message[];
  isHost: boolean | null;
}

function MessageList({ messages, isHost }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="messages__empty">
        <span>아직 메시지가 없습니다.</span>
        <span className="messages__empty-sub">연결 후 채팅을 시작해보세요!</span>
      </div>
    );
  }

  return (
    <div className="messages">
      {messages.map((msg) => {
        if (msg.sender === 'system') {
          return (
            <div key={msg.id} className="message message--system">
              <span className="message__system-text">{msg.text}</span>
              <span className="message__system-time">{formatTime(msg.timestamp)}</span>
            </div>
          );
        }
        const isMe = msg.sender === 'me';
        const displayName = isMe ? '나' : isHost ? '게스트 (B)' : '호스트 (A)';
        const avatarLetter = isMe ? 'M' : 'P';

        return (
          <div key={msg.id} className={`message message--${msg.sender}`}>
            <div className="message__avatar" data-sender={msg.sender} title={displayName}>
              {avatarLetter}
            </div>
            <div className="message__body">
              <div className="message__header">
                <span className="message__name">{displayName}</span>
                <span className="message__time">{formatTime(msg.timestamp)}</span>
              </div>
              <div className="message__text">{msg.text}</div>
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}

// ─── MessageInput ───────────────────────────────────────────────

interface MessageInputProps {
  onSend: (text: string) => void;
  disabled: boolean;
}

function MessageInput({ onSend, disabled }: MessageInputProps) {
  const [text, setText] = useState('');

  const handleSend = useCallback(() => {
    if (!text.trim()) return;
    onSend(text);
    setText('');
  }, [text, onSend]);

  return (
    <div className="input-area">
      <div className="input-area__inner">
        <input
          className="input-area__input"
          type="text"
          placeholder={disabled ? '연결 대기 중...' : '메시지를 입력하세요... (🔒 DTLS 암호화)'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={disabled}
        />
        <button
          className="btn btn--send"
          onClick={handleSend}
          disabled={disabled || !text.trim()}
          title="전송 (Enter)"
        >
          전송
        </button>
      </div>
    </div>
  );
}

// ─── ChatLayout ─────────────────────────────────────────────────

interface ChatLayoutProps {
  status: ConnectionStatus;
  messages: Message[];
  isHost: boolean | null;
  onSend: (text: string) => void;
  onReset: () => void;
}

function ChatLayout({ status, messages, isHost, onSend, onReset }: ChatLayoutProps) {
  const isChatEnabled = status === 'connected';
  const showDisconnected = status === 'disconnected';

  return (
    <div className="chat-layout">
      <header className="chat-header">
        <div className="chat-header__left">
          <span className="chat-header__hash">#</span>
          <span className="chat-header__room-name">채팅방</span>
          <span className="chat-header__room-id">
            {isHost ? '호스트 (A)' : '게스트 (B)'}
          </span>
        </div>
        <div className="chat-header__right">
          <span className={statusDotClass(status)} />
          <span className="chat-header__status">{statusLabel(status)}</span>
        </div>
      </header>

      <div className="chat-body">
        {showDisconnected && (
          <div className="chat-notice chat-notice--disconnected">
            <div className="chat-notice__icon">🔌</div>
            <div className="chat-notice__title">연결이 끊어졌습니다.</div>
            <div className="chat-notice__desc">채팅 기록은 위에서 확인할 수 있습니다.</div>
            <button className="btn btn--primary" onClick={onReset}>
              🔄 처음부터
            </button>
          </div>
        )}
        <MessageList messages={messages} isHost={isHost} />
      </div>

      <MessageInput onSend={onSend} disabled={!isChatEnabled} />
    </div>
  );
}

// ─── App (루트) ─────────────────────────────────────────────────

export default function App() {
  // 앱 마운트 시 URL hash에서 invite payload 추출 (변경 없음)
  const [invitePayload] = useState<string | null>(() => extractInvitePayload());

  const {
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
  } = useChat();

  const showChat = status === 'connected' || status === 'disconnected';

  return (
    <div className="app">
      <Sidebar status={status} isHost={isHost} onReset={reset} />
      <div className="main">
        {showChat ? (
          <ChatLayout
            status={status}
            messages={messages}
            isHost={isHost}
            onSend={sendMessage}
            onReset={reset}
          />
        ) : (
          <ManualSignaling
            status={status}
            isHost={isHost}
            offerCode={offerCode}
            answerCode={answerCode}
            error={error}
            onStartHost={startHost}
            onStartGuest={startGuest}
            onCompleteConnection={completeConnection}
            onReset={reset}
            invitePayload={invitePayload}
          />
        )}
      </div>
    </div>
  );
}
