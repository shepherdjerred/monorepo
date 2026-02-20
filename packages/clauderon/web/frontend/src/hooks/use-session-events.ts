import { useRef } from "react";
import type { EventsClient, SessionEvent } from "@clauderon/client";

/**
 * Hook to subscribe to session events via WebSocket
 */
export function useSessionEvents(_onEvent: (event: SessionEvent) => void) {
  const clientRef = useRef<EventsClient | null>(null);

  return clientRef.current;
}
