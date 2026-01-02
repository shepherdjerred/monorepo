import { useEffect, useRef } from "react";
import { EventsClient, type SessionEvent } from "@clauderon/client";

/**
 * Hook to subscribe to session events via WebSocket
 */
export function useSessionEvents(onEvent: (event: SessionEvent) => void) {
  const clientRef = useRef<EventsClient | null>(null);

  useEffect(() => {
    const client = new EventsClient();
    clientRef.current = client;

    const unsubscribe = client.onEvent(onEvent);

    client.connect();

    return () => {
      unsubscribe();
      client.disconnect();
    };
  }, [onEvent]);

  return clientRef.current;
}
