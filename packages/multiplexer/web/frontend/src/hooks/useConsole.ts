import { useEffect, useRef, useState } from "react";
import { ConsoleClient } from "@mux/client";

/**
 * Hook to manage a console WebSocket connection
 */
export function useConsole(sessionId: string | null) {
  const clientRef = useRef<ConsoleClient | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    const client = new ConsoleClient();
    clientRef.current = client;

    const unsubscribeConnected = client.onConnected(() => {
      setIsConnected(true);
    });

    const unsubscribeDisconnected = client.onDisconnected(() => {
      setIsConnected(false);
    });

    client.connect(sessionId);

    return () => {
      unsubscribeConnected();
      unsubscribeDisconnected();
      client.disconnect();
    };
  }, [sessionId]);

  return {
    client: clientRef.current,
    isConnected,
  };
}
