/**
 * Live updates. Each stream URL (the whole module, or one `INC-N`) is one
 * shared `EventSource`, opened by its first subscriber and closed with its
 * last. Frames only name what changed; the pages refetch through React Query.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useSyncExternalStore } from "react";
import { z } from "zod";
import {
  INCIDENT_STREAM_EVENT,
  INCIDENTS_API_PREFIX,
  IncidentStreamFrameSchema,
  type IncidentStreamFrame,
} from "#shared/contract.ts";
import { incidentsKeys } from "#client/api.ts";
import { EVENT_LABEL } from "#client/format.ts";

export type StreamSnapshot = {
  readonly connected: boolean;
  /** Last frame, for the visible indicator and the live region. */
  readonly lastFrame: IncidentStreamFrame | null;
};

type Subscriber = {
  readonly onChange: () => void;
  readonly onFrame: (frame: IncidentStreamFrame) => void;
  readonly onReconnect: () => void;
};

type Stream = {
  readonly subscribe: (subscriber: Subscriber) => () => void;
  readonly snapshot: () => StreamSnapshot;
};

const DISCONNECTED: StreamSnapshot = { connected: false, lastFrame: null };

export function streamUrl(identifier: string | null): string {
  const base = `${INCIDENTS_API_PREFIX}/events/stream`;
  return identifier === null
    ? base
    : `${base}?incident=${encodeURIComponent(identifier)}`;
}

function createStream(url: string): Stream {
  const subscribers = new Set<Subscriber>();
  let source: EventSource | null = null;
  let snapshot = DISCONNECTED;
  let droppedOnce = false;

  const publish = (next: StreamSnapshot) => {
    snapshot = next;
    for (const subscriber of subscribers) subscriber.onChange();
  };

  const open = () => {
    const opened = new EventSource(url);
    opened.addEventListener("open", () => {
      // Frames sent while disconnected are gone; refetch to catch up.
      if (droppedOnce)
        for (const subscriber of subscribers) subscriber.onReconnect();
      publish({ ...snapshot, connected: true });
    });
    opened.addEventListener("error", () => {
      droppedOnce = true;
      publish({ ...snapshot, connected: false });
    });
    opened.addEventListener(INCIDENT_STREAM_EVENT, (event) => {
      const data = z.string().parse(event.data);
      const frame = IncidentStreamFrameSchema.parse(JSON.parse(data));
      for (const subscriber of subscribers) subscriber.onFrame(frame);
      publish({ connected: true, lastFrame: frame });
    });
    return opened;
  };

  return {
    subscribe: (subscriber) => {
      subscribers.add(subscriber);
      source ??= open();
      return () => {
        subscribers.delete(subscriber);
        if (source === null || subscribers.size > 0) return;
        source.close();
        source = null;
        droppedOnce = false;
        snapshot = DISCONNECTED;
      };
    },
    snapshot: () => snapshot,
  };
}

const streams = new Map<string, Stream>();

function streamFor(url: string): Stream {
  const existing = streams.get(url);
  if (existing !== undefined) return existing;
  const created = createStream(url);
  streams.set(url, created);
  return created;
}

const serverSnapshot = (): StreamSnapshot => DISCONNECTED;

/**
 * Subscribe to the module stream (`identifier === null`) or one incident's,
 * refetching every incidents query on each frame and after a reconnect.
 */
export function useIncidentStream(identifier: string | null): StreamSnapshot {
  const queryClient = useQueryClient();
  const stream = streamFor(streamUrl(identifier));
  const subscribe = useCallback(
    (onChange: () => void) => {
      const refetch = () => {
        void queryClient.invalidateQueries({ queryKey: incidentsKeys.all });
      };
      return stream.subscribe({
        onChange,
        onFrame: refetch,
        onReconnect: refetch,
      });
    },
    [stream, queryClient],
  );
  return useSyncExternalStore(subscribe, stream.snapshot, serverSnapshot);
}

/** The sentence the live region announces for a frame. */
export function describeFrame(frame: IncidentStreamFrame): string {
  return `${frame.identifier}: ${EVENT_LABEL[frame.type].toLowerCase()}`;
}

type Tick = {
  now: number;
  timer: ReturnType<typeof setInterval> | null;
  readonly listeners: Set<() => void>;
};

const ticks = new Map<number, Tick>();

function tickFor(intervalMs: number): Tick {
  const existing = ticks.get(intervalMs);
  if (existing !== undefined) return existing;
  const created: Tick = { now: Date.now(), timer: null, listeners: new Set() };
  ticks.set(intervalMs, created);
  return created;
}

/**
 * The current time, re-read every `intervalMs` while anything is mounted, so
 * countdowns ("eligible in 4m") advance without a refetch. One timer per
 * interval serves every component.
 */
export function useNow(intervalMs = 15_000): number {
  const tick = tickFor(intervalMs);
  const subscribe = useCallback(
    (onChange: () => void) => {
      tick.listeners.add(onChange);
      if (tick.timer === null) {
        tick.now = Date.now();
        tick.timer = setInterval(() => {
          tick.now = Date.now();
          for (const listener of tick.listeners) listener();
        }, intervalMs);
      }
      return () => {
        tick.listeners.delete(onChange);
        if (tick.listeners.size > 0 || tick.timer === null) return;
        clearInterval(tick.timer);
        tick.timer = null;
      };
    },
    [tick, intervalMs],
  );
  return useSyncExternalStore(
    subscribe,
    () => tick.now,
    () => tick.now,
  );
}
