import { useState, useEffect, useCallback, useRef } from "react";
import type {
  ClientMessage,
  ServerMessage,
  Message,
  ContentBlock,
} from "../types";

interface WebSocketState {
  connected: boolean;
  messages: Message[];
  error: string | null;
  isProcessing: boolean;
}

export function useWebSocket(sessionId: string | null) {
  const [state, setState] = useState<WebSocketState>({
    connected: false,
    messages: [],
    error: null,
    isProcessing: false,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const connect = useCallback(() => {
    if (!sessionId || wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/ws/sessions/${sessionId}`,
    );

    ws.onopen = () => {
      setState((s) => ({ ...s, connected: true, error: null }));

      // Start ping interval
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 30000);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as Record<string, unknown>;
        handleServerMessage(message);
      } catch (error) {
        console.error("Failed to parse WebSocket message:", error);
      }
    };

    ws.onerror = () => {
      setState((s) => ({ ...s, error: "WebSocket connection error" }));
    };

    ws.onclose = (event) => {
      setState((s) => ({ ...s, connected: false }));
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }

      // Reconnect on abnormal close (but not on intentional close)
      if (event.code !== 1000 && event.code !== 1001) {
        setTimeout(() => {
          connect();
        }, 2000);
      }
    };

    wsRef.current = ws;
  }, [sessionId]);

  const handleServerMessage = useCallback(
    (message: Record<string, unknown>) => {
      console.log("Server message:", message);

      switch (message.type) {
        case "assistant": {
          // SDK format: { type: "assistant", message: { role, content, ... } }
          const sdkMessage = message.message as
            | { content?: ContentBlock[] }
            | undefined;
          const content =
            sdkMessage?.content ||
            (message.content as ContentBlock[] | undefined);

          if (content && Array.isArray(content)) {
            setState((s) => {
              const newMessage: Message = {
                id: crypto.randomUUID(),
                role: "assistant",
                content,
                timestamp: Date.now(),
              };
              return {
                ...s,
                messages: [...s.messages, newMessage],
                isProcessing: true,
              };
            });
          }
          break;
        }

        case "result":
          setState((s) => ({
            ...s,
            isProcessing: false,
            error:
              message.subtype === "error"
                ? (message.error as string) || "Unknown error"
                : null,
          }));
          break;

        case "error":
          setState((s) => ({
            ...s,
            error: message.message as string,
            isProcessing: false,
          }));
          break;

        case "ready":
          // Container ready signal
          console.log("Container ready:", message.sessionId);
          break;

        case "system":
          // SDK system messages (init, etc.)
          console.log("System message:", message);
          break;

        case "pong":
          // Heartbeat response, no action needed
          break;

        default:
          console.log("Unknown message type:", message.type);
      }
    },
    [],
  );

  useEffect(() => {
    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close(1000, "Component unmounting");
        wsRef.current = null;
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
    };
  }, [connect]);

  const sendPrompt = useCallback((content: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setState((s) => ({ ...s, error: "Not connected" }));
      return;
    }

    // Add user message to state
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: [{ type: "text", text: content }],
      timestamp: Date.now(),
    };

    setState((s) => ({
      ...s,
      messages: [...s.messages, userMessage],
      isProcessing: true,
      error: null,
    }));

    const message: ClientMessage = { type: "prompt", content };
    wsRef.current.send(JSON.stringify(message));
  }, []);

  const interrupt = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const message: ClientMessage = { type: "interrupt" };
    wsRef.current.send(JSON.stringify(message));
  }, []);

  const clearMessages = useCallback(() => {
    setState((s) => ({ ...s, messages: [] }));
  }, []);

  return {
    connected: state.connected,
    messages: state.messages,
    error: state.error,
    isProcessing: state.isProcessing,
    sendPrompt,
    interrupt,
    clearMessages,
  };
}
