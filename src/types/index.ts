export interface Message {
  id: string;
  text: string;
  sender: 'me' | 'peer' | 'system';
  timestamp: Date;
}

export type ConnectionStatus =
  | 'idle'
  | 'gathering'      // ICE 수집 중 (offer 또는 answer 생성 중)
  | 'offer-ready'    // 호스트: offer 코드 생성 완료, answer 대기
  | 'answer-ready'   // 게스트: answer 코드 생성 완료, 호스트 붙여넣기 대기
  | 'connecting'     // 호스트: answer 수신 후 DataChannel 열릴 때까지 대기
  | 'connected'
  | 'disconnected';
