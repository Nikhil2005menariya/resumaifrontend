/**
 * WebSocket hook for real-time agent status updates
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuthStore } from './store';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000';

export interface AgentStatusUpdate {
  type: string;
  status?: string;
  message?: string;
  timestamp?: string;
}

export interface TaskCompleteResult {
  resume_id?: string;
  status?: string;
  message?: string;
  has_pdf?: boolean;
  jobs?: any[];
}

export function useAgentWebSocket(sessionId?: string) {
  const { user } = useAuthStore();
  const [isConnected, setIsConnected] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatusUpdate | null>(null);
  const [lastResult, setLastResult] = useState<TaskCompleteResult | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const connect = useCallback(() => {
    if (!user?.id) return;

    const userId = user.id;
    const wsSession = sessionId || 'default';
    const url = `${WS_URL}/ws/agent/${userId}?session_id=${wsSession}`;

    try {
      const ws = new WebSocket(url);

      ws.onopen = () => {
        console.log('WebSocket connected');
        setIsConnected(true);
        setReconnectAttempts(0);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('WebSocket message:', data);

          if (data.type === 'status_update') {
            setAgentStatus(data);
          } else if (data.type === 'task_complete') {
            setLastResult(data.result);
            setAgentStatus({
              type: 'completed',
              status: 'completed',
              message: 'Task completed'
            });
          } else if (data.type === 'error') {
            console.error('WebSocket error:', data.message);
            setAgentStatus({
              type: 'error',
              status: 'error',
              message: data.message
            });
          }
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setIsConnected(false);
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setIsConnected(false);

        // Attempt to reconnect with exponential backoff
        if (reconnectAttempts < 5) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000);
          console.log(`Reconnecting in ${delay}ms...`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            setReconnectAttempts(prev => prev + 1);
            connect();
          }, delay);
        }
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
    }
  }, [user?.id, sessionId, reconnectAttempts]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    setIsConnected(false);
  }, []);

  const sendMessage = useCallback((message: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
      return true;
    }
    console.error('WebSocket not connected');
    return false;
  }, []);

  // Send task to agent
  const generateResume = useCallback((jobDescription: string, instructions?: string) => {
    return sendMessage({
      type: 'generate_resume',
      job_description: jobDescription,
      instructions
    });
  }, [sendMessage]);

  const refineResume = useCallback((resumeId: string, message: string) => {
    return sendMessage({
      type: 'refine_resume',
      resume_id: resumeId,
      message
    });
  }, [sendMessage]);

  const searchJobs = useCallback((query: string) => {
    return sendMessage({
      type: 'search_jobs',
      query
    });
  }, [sendMessage]);

  // Ping to keep connection alive
  useEffect(() => {
    if (!isConnected) return;

    const pingInterval = setInterval(() => {
      sendMessage({ type: 'ping' });
    }, 30000); // Ping every 30 seconds

    return () => clearInterval(pingInterval);
  }, [isConnected, sendMessage]);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return {
    isConnected,
    agentStatus,
    lastResult,
    generateResume,
    refineResume,
    searchJobs,
    sendMessage,
    reconnect: connect,
    disconnect
  };
}
