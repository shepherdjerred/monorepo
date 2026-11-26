/**
 * Hub's incident change stream (`GET /api/incidents/events/stream`). Frames
 * only name what changed; callers refetch. One connection per watcher, never
 * a poll.
 */
import {
  IncidentStreamFrameSchema,
  type IncidentStreamFrame,
} from "@shepherdjerred/incidents/contract";
import { readSseFrames } from "#lib/sse.ts";
import { hubBaseUrl, INCIDENTS_API_PATH } from "./client.ts";
import { pause, type Scheduler } from "./scheduler.ts";

export type IncidentStreamHandlers = {
  /** The server's first bytes arrived: the subscription is live, so a refetch now misses nothing. */
  readonly onOpen: () => void;
  readonly onFrame: (frame: IncidentStreamFrame) => void;
};

/**
 * Hold one stream until it ends (resolves) or fails (rejects). `identifier`
 * limits it to one incident. The caller owns reconnection.
 */
export type IncidentStream = (
  identifier: string | null,
  signal: AbortSignal,
  handlers: IncidentStreamHandlers,
) => Promise<void>;

export function incidentStream(baseUrl: string): IncidentStream {
  const base = `${hubBaseUrl(baseUrl)}${INCIDENTS_API_PATH}/events/stream`;
  return async (identifier, signal, handlers) => {
    const url =
      identifier === null
        ? base
        : `${base}?incident=${encodeURIComponent(identifier)}`;
    const response = await fetch(url, {
      headers: { Accept: "text/event-stream" },
      signal,
    });
    if (!response.ok || response.body === null)
      throw new Error(
        `Incident event stream failed (HTTP ${String(response.status)})`,
      );
    await readSseFrames(
      response.body,
      (data) => {
        handlers.onFrame(IncidentStreamFrameSchema.parse(JSON.parse(data)));
        return Promise.resolve(false);
      },
      { onFirstChunk: handlers.onOpen },
    );
  };
}

const MAX_BACKOFF_MS = 30_000;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Hold one stream until `signal` aborts, reconnecting with backoff (1 s
 * doubling to 30 s). Every reconnect calls `onOpen` again, so the caller
 * refetches whatever it missed while disconnected.
 */
export async function holdStream(
  deps: {
    readonly stream: IncidentStream;
    readonly scheduler: Scheduler;
    readonly log: (line: string) => void;
  },
  identifier: string | null,
  signal: AbortSignal,
  handlers: IncidentStreamHandlers,
): Promise<void> {
  let backoff = 1000;
  const stopped = () => signal.aborted;
  while (!stopped()) {
    try {
      await deps.stream(identifier, signal, {
        onOpen: () => {
          backoff = 1000;
          handlers.onOpen();
        },
        onFrame: handlers.onFrame,
      });
      if (stopped()) return;
      deps.log(
        `Incident stream closed; reconnecting in ${String(backoff / 1000)}s.`,
      );
    } catch (error) {
      if (stopped()) return;
      deps.log(
        `Incident stream failed (${message(error)}); reconnecting in ${String(backoff / 1000)}s.`,
      );
    }
    await pause(deps.scheduler, backoff, signal);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  }
}
