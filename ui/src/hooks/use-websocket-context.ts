import { useContext } from 'react';
import { WSContext } from '@/contexts/ws-context';

export function useWebSocketContext() {
  const context = useContext(WSContext);
  if (!context) {
    throw new Error('useWebSocketContext must be used within WebSocketProvider');
  }
  return context;
}
