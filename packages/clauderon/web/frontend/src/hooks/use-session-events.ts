import { useEffect, useRef } from "react";
import { EventsClient, type SessionEvent } from "@clauderon/client";

/**
 * Hook to subscribe to session events via WebSocket
 */
export function useSessionEvents(onEvent: (event: SessionEvent) => void) {
  const clientRef = useRef<EventsClient | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    const client = new EventsClient();
    clientRef.current = client;

    client.onEvent((event) => {
      onEventRef.current(event);
    });

    client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, []);

  return clientRef.current;
}
