import { useEffect, useRef, useState } from "react";
import { ConsoleClient } from "@clauderon/client";

/**
 * Hook to manage a console WebSocket connection
 */
export function useConsole(sessionId: string | null) {
  const clientRef = useRef<ConsoleClient | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (sessionId == null) {
      return;
    }

    const client = new ConsoleClient();
    clientRef.current = client;

    client.onConnected(() => {
      setIsConnected(true);
    });

    client.onDisconnected(() => {
      setIsConnected(false);
    });

    client.connect(sessionId);

    return () => {
      client.disconnect();
      clientRef.current = null;
      setIsConnected(false);
    };
  }, [sessionId]);

  return {
    client: clientRef.current,
    isConnected,
  };
}
