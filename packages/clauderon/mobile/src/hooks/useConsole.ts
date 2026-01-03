import { useEffect, useState, useMemo } from "react";
import { ConsoleClient } from "../api/ConsoleClient";
import { useSettings } from "./useSettings";

/**
 * Hook to manage a console WebSocket connection
 */
export function useConsole(sessionId: string | null) {
  const { daemonUrl } = useSettings();
  const [isConnected, setIsConnected] = useState(false);

  const client = useMemo(() => {
    if (!daemonUrl) {
      return null;
    }
    // Convert HTTP URL to WebSocket URL
    const wsUrl = daemonUrl.replace(/^http/, "ws") + "/ws/console";
    return new ConsoleClient({ baseUrl: wsUrl });
  }, [daemonUrl]);

  useEffect(() => {
    if (!client || !sessionId) {
      return;
    }

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
  }, [client, sessionId]);

  return {
    client,
    isConnected,
  };
}
