import { useEffect } from "react";
import type { SessionEvent } from "../api/EventsClient";
import type { EventsClient } from "../api/EventsClient";

/**
 * Hook to subscribe to session events
 */
export function useSessionEvents(
  client: EventsClient | null,
  onEvent: (event: SessionEvent) => void
) {
  useEffect(() => {
    if (!client) {
      return;
    }

    const unsubscribe = client.onEvent(onEvent);

    return () => {
      unsubscribe();
    };
  }, [client, onEvent]);
}
