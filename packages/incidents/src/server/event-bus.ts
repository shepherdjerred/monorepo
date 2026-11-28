/**
 * In-process fan-out of committed changes to `/events/stream` subscribers.
 * Hub runs as a single replica (Recreate strategy), so every writer and every
 * stream share this one process; there is no cross-replica delivery.
 */
import type { IncidentStreamFrame } from "#shared/contract.ts";

export type IncidentEventBus = {
  readonly publish: (frame: IncidentStreamFrame) => void;
  /** Returns the unsubscribe function. */
  readonly subscribe: (
    listener: (frame: IncidentStreamFrame) => void,
  ) => () => void;
  readonly subscriberCount: () => number;
};

export function createIncidentEventBus(): IncidentEventBus {
  const listeners = new Set<(frame: IncidentStreamFrame) => void>();
  return {
    publish: (frame) => {
      for (const listener of listeners) {
        try {
          listener(frame);
        } catch (error: unknown) {
          console.error(
            JSON.stringify({
              level: "error",
              message: "incidents_stream_listener_failed",
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscriberCount: () => listeners.size,
  };
}
