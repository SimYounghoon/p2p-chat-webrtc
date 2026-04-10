import { useState, useRef, useEffect, useCallback } from 'react';
import { useChat } from './hooks/useChat';
import { ConnectionStatus, Message } from './types';

// ─── 유틸 함수 ─────────────────────────────────────────────────

function formatTime(date: Date): string {
  return date.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusLabel(status: ConnectionStatus): string {
  switch (status) {
    case 'idle':
      return '대기 중';
    case 'creating':
      return '방 생성 중...';
    case 'waiting':
      return '상대방 기다리는 중';
    case 'joining':
      return '입장 중...';
    case 'connecting':
      return 'P2P 연결 중...';
    case 'connected':
      return '연결됨';
    case 'disconnected':
      return '연결 끊김';
    default:
      return '';
  }
}

function statusDotClass(status: ConnectionStatus): string {
  if (status === 'connected') return 'status-dot status-dot--online';
  if (status === 'disconnected') return 'status-dot status-dot--offline';
  if (['creating', 'waiting', 'joining', 'connecting'].includes(status))
    return 'status-dot status-dot--busy';
  return 'status-dot status-dot--idle';
}

// ─── Sidebar ────────────────────────────────────────────────────

interface SidebarProps {
  status: ConnectionStatus;
  roomId: string | null;
  isHost: boolean | null;
  onDisconnect: () => void;
}

function Sidebar({ status, roomId, isHost, onDisconnect }: SidebarProps) {
  const isInRoom = status !== 'idle';

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

        <div className={`sidebar__item ${isInRoom ? 'sidebar__item--active' : ''}`}>
          <span className="sidebar__item-icon">#</span>
          <span>채팅방</span>
        </div>

        {roomId && (
          <div className="sidebar__room-info">
            <div className="sidebar__room-id-label">방 ID</div>
            <div className="sidebar__room-id-value">{roomId}</div>
            {isHost !== null && (
              <div className="sidebar__role-badge">
                {isHost ? '👑 호스트' : '🙋 게스트'}
              </div>
            )}
          </div>
        )}

        <div className="sidebar__section-label sidebar__section-label--top">상태</div>
        <div className="sidebar__status">
          <span className={statusDotClass(status)} />
          <span className="sidebar__status-text">{statusLabel(status)}</span>
        </div>
      </nav>

      {isInRoom && (
        <div className="sidebar__footer">
          <button className="sidebar__disconnect-btn" onClick={onDisconnect}>
            🚪 나가기
          </button>
        </div>
      )}
    </aside>
  );
}

// ─── Lobby ──────────────────────────────────────────────────────

interface LobbyProps {
  status: ConnectionStatus;
  onCreateRoom: () => void;
  onJoinRoom: (id: string) => void;
}

function Lobby({ status, onCreateRoom, onJoinRoom }: LobbyProps) {
  const [joinId, setJoinId] = useState('');
  const isLoading = status === 'creating' || status === 'joining';

  const handleJoin = () => {
    if (joinId.trim()) onJoinRoom(joinId);
  };

  return (
    <div className="lobby">
      <div className="lobby__card">
        <div className="lobby__title">
          <span className="lobby__title-icon">💬</span>
          <h1>P2P 채팅</h1>
        </div>
        <p className="lobby__subtitle">WebRTC 기반 1:1 직접 채팅</p>

        <div className="lobby__section">
          <h2 className="lobby__section-title">새 채팅방 만들기</h2>
          <button
            className="btn btn--primary btn--full"
            onClick={onCreateRoom}
            disabled={isLoading}
          >
            {status === 'creating' ? (
              <><span className="spinner" /> 방 생성 중...</>
            ) : (
              '🏠 방 만들기'
            )}
          </button>
        </div>

        <div className="lobby__divider">
          <span>또는</span>
        </div>

        <div className="lobby__section">
          <h2 className="lobby__section-title">기존 방 참여하기</h2>
          <div className="lobby__join-row">
            <input
              className="input"
              type="text"
              placeholder="방 ID 입력 (예: ABC123)"
              value={joinId}
              onChange={(e) => setJoinId(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              disabled={isLoading}
              maxLength={10}
            />
            <button
              className="btn btn--secondary"
              onClick={handleJoin}
              disabled={isLoading || !joinId.trim()}
            >
              {status === 'joining' ? (
                <><span className="spinner" /> 입장 중...</>
              ) : (
                '참여하기'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
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
        const displayName = isMe ? '나' : isHost ? '게스트' : '호스트';
        const avatarLetter = isMe ? 'M' : 'P';

        return (
          <div key={msg.id} className={`message message--${msg.sender}`}>
            <div
              className="message__avatar"
              data-sender={msg.sender}
              title={displayName}
            >
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
          placeholder={disabled ? '연결 대기 중...' : '메시지를 입력하세요...'}
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
  roomId: string | null;
  messages: Message[];
  isHost: boolean | null;
  onSend: (text: string) => void;
  onResetToLobby: () => void;
}

function ChatLayout({
  status,
  roomId,
  messages,
  isHost,
  onSend,
  onResetToLobby,
}: ChatLayoutProps) {
  const [copied, setCopied] = useState(false);

  const copyRoomId = useCallback(() => {
    if (!roomId) return;
    navigator.clipboard.writeText(roomId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [roomId]);

  const isChatEnabled = status === 'connected';
  const showWaiting = status === 'waiting';
  const showConnecting = status === 'connecting';
  const showDisconnected = status === 'disconnected';

  return (
    <div className="chat-layout">
      {/* 헤더 */}
      <header className="chat-header">
        <div className="chat-header__left">
          <span className="chat-header__hash">#</span>
          <span className="chat-header__room-name">채팅방</span>
          {roomId && (
            <span className="chat-header__room-id">
              {roomId}
              <button
                className="btn btn--copy"
                onClick={copyRoomId}
                title="방 ID 복사"
              >
                {copied ? '✅ 복사됨' : '📋 복사'}
              </button>
            </span>
          )}
        </div>
        <div className="chat-header__right">
          <span className={statusDotClass(status)} />
          <span className="chat-header__status">{statusLabel(status)}</span>
        </div>
      </header>

      {/* 메시지 영역 */}
      <div className="chat-body">
        {showWaiting && (
          <div className="chat-notice chat-notice--waiting">
            <div className="chat-notice__icon">⏳</div>
            <div className="chat-notice__title">상대방을 기다리는 중...</div>
            <div className="chat-notice__desc">
              아래 방 ID를 상대방에게 공유하세요.
            </div>
            {roomId && (
              <div className="chat-notice__room-id">
                <span>{roomId}</span>
                <button className="btn btn--copy" onClick={copyRoomId}>
                  {copied ? '✅ 복사됨' : '📋 복사'}
                </button>
              </div>
            )}
          </div>
        )}

        {showConnecting && (
          <div className="chat-notice chat-notice--connecting">
            <div className="chat-notice__icon">
              <span className="spinner spinner--large" />
            </div>
            <div className="chat-notice__title">P2P 연결 중...</div>
            <div className="chat-notice__desc">잠시만 기다려주세요.</div>
          </div>
        )}

        {showDisconnected && (
          <div className="chat-notice chat-notice--disconnected">
            <div className="chat-notice__icon">🔌</div>
            <div className="chat-notice__title">연결이 끊어졌습니다.</div>
            <div className="chat-notice__desc">
              채팅 기록은 위에서 확인할 수 있습니다.
            </div>
            <button className="btn btn--primary" onClick={onResetToLobby}>
              🏠 로비로 돌아가기
            </button>
          </div>
        )}

        <MessageList messages={messages} isHost={isHost} />
      </div>

      {/* 입력창 */}
      <MessageInput onSend={onSend} disabled={!isChatEnabled} />
    </div>
  );
}

// ─── App (루트) ─────────────────────────────────────────────────

export default function App() {
  const { status, roomId, messages, isHost, createRoom, joinRoom, sendMessage, disconnect, resetToLobby } =
    useChat();

  const showLobby = status === 'idle';

  return (
    <div className="app">
      <Sidebar
        status={status}
        roomId={roomId}
        isHost={isHost}
        onDisconnect={disconnect}
      />
      <div className="main">
        {showLobby ? (
          <Lobby
            status={status}
            onCreateRoom={createRoom}
            onJoinRoom={joinRoom}
          />
        ) : (
          <ChatLayout
            status={status}
            roomId={roomId}
            messages={messages}
            isHost={isHost}
            onSend={sendMessage}
            onResetToLobby={resetToLobby}
          />
        )}
      </div>
    </div>
  );
}
