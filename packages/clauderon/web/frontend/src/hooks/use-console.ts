import { useEffect, useRef, useState } from "react";
import type { ConsoleClient } from "@clauderon/client";

/**
 * Hook to manage a console WebSocket connection
 */
export function useConsole(sessionId: string | null) {
  const clientRef = useRef<ConsoleClient | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  ;

  return {
    client: clientRef.current,
    isConnected,
  };
}
