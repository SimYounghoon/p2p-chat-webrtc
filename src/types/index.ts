export interface Message {
  id: string;
  text: string;
  sender: 'me' | 'peer' | 'system';
  timestamp: Date;
}

export type ConnectionStatus =
  | 'idle'
  | 'creating'
  | 'waiting'
  | 'joining'
  | 'connecting'
  | 'connected'
  | 'disconnected';
