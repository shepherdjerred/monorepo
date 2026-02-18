import { useEffect, useRef } from "react";
import type { EventsClient} from "@clauderon/client";
import { type SessionEvent } from "@clauderon/client";

/**
 * Hook to subscribe to session events via WebSocket
 */
export function useSessionEvents(onEvent: (event: SessionEvent) => void) {
  const clientRef = useRef<EventsClient | null>(null);

  ;

  return clientRef.current;
}
