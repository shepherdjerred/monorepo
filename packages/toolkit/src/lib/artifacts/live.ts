import {
  LiveMessageSchema,
  type LiveMessage,
} from "@shepherdjerred/artifacts/contract";
import type { ArtifactsClient } from "./client.ts";
import { failureFromResponse } from "./client.ts";
import { ArtifactsCliError } from "./errors.ts";

export type SseFrame = {
  event: string | undefined;
  data: string;
  id: string | undefined;
};

function takeLines(buffer: string): { lines: string[]; rest: string } {
  const lines: string[] = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index++) {
    const character = buffer[index];
    if (character === "\n") {
      lines.push(buffer.slice(start, index));
      start = index + 1;
    } else if (character === "\r") {
      // A trailing CR may be the first half of CRLF: wait for the next chunk.
      if (index === buffer.length - 1) break;
      lines.push(buffer.slice(start, index));
      if (buffer[index + 1] === "\n") index++;
      start = index + 1;
    }
  }
  return { lines, rest: buffer.slice(start) };
}

type PendingFrame = {
  event: string | undefined;
  id: string | undefined;
  data: string[];
};

const freshFrame = (): PendingFrame => ({
  event: undefined,
  id: undefined,
  data: [],
});

/** Applies one non-empty line to the frame being built; comments are ignored. */
function applyLine(frame: PendingFrame, line: string): void {
  if (line.startsWith(":")) return;
  const colon = line.indexOf(":");
  const field = colon === -1 ? line : line.slice(0, colon);
  const raw = colon === -1 ? "" : line.slice(colon + 1);
  const value = raw.startsWith(" ") ? raw.slice(1) : raw;
  switch (field) {
    case "data": {
      frame.data.push(value);
      break;
    }
    case "event": {
      frame.event = value;
      break;
    }
    case "id": {
      frame.id = value;
      break;
    }
    // No default
  }
}

/**
 * Parses a server-sent-event stream into frames. Comments (`:` lines, which
 * heartbeats may use) and unknown fields are ignored; an event cut off by the
 * end of the stream is dropped, as the specification says.
 */
export async function* parseSse(
  chunks: AsyncIterable<Uint8Array>,
): AsyncGenerator<SseFrame> {
  const decoder = new TextDecoder();
  let buffer = "";
  let frame = freshFrame();
  for await (const chunk of chunks) {
    buffer += decoder.decode(chunk, { stream: true });
    const { lines, rest } = takeLines(buffer);
    buffer = rest;
    for (const line of lines) {
      if (line !== "") {
        applyLine(frame, line);
        continue;
      }
      if (frame.data.length > 0)
        yield { event: frame.event, data: frame.data.join("\n"), id: frame.id };
      frame = freshFrame();
    }
  }
}

export type LiveEvent =
  { type: "open" } | { type: "message"; message: LiveMessage };

export type LiveScope = { board?: string; artifact?: string };

/** The server sends a heartbeat every 8 s; this much silence means a dead stream. */
export const STREAM_IDLE_MS = 45_000;

type ChunkReader = {
  read: () => Promise<
    { done: true; value?: undefined } | { done: false; value: Uint8Array }
  >;
};

/**
 * Reads chunks, failing on silence and on abort. A response body does not
 * always end when its request is aborted; do not depend on it, or a finished
 * wait would hang on its own stream.
 */
async function* chunksWithWatchdog(
  reader: ChunkReader,
  idleMs: number,
  signal: AbortSignal,
): AsyncGenerator<Uint8Array> {
  for (;;) {
    signal.throwIfAborted();
    const stop = Promise.withResolvers<never>();
    const idleTimer = setTimeout(() => {
      stop.reject(
        new ArtifactsCliError(
          "unreachable",
          "The feedback stream went silent; reconnecting.",
        ),
      );
    }, idleMs);
    const onAbort = () => {
      stop.reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException("The operation was aborted.", "AbortError"),
      );
    };
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      const result = await Promise.race([reader.read(), stop.promise]);
      if (result.done) return;
      yield result.value;
    } finally {
      clearTimeout(idleTimer);
      signal.removeEventListener("abort", onAbort);
    }
  }
}

/**
 * One connection to the feedback stream: yields `open` once the service
 * accepted it, then every message that parses. It only wakes a waiter; the
 * claim carries the data. Ends when the stream does; throws when the
 * connection fails or goes silent (the caller reconnects).
 */
export async function* streamLive(
  client: ArtifactsClient,
  scope: LiveScope,
  signal: AbortSignal,
  options: { idleMs?: number } = {},
): AsyncGenerator<LiveEvent> {
  const query = new URLSearchParams();
  if (scope.board !== undefined) query.set("board", scope.board);
  if (scope.artifact !== undefined) query.set("artifact", scope.artifact);
  const suffix = query.size === 0 ? "" : `?${query.toString()}`;
  const response = await client.request(`/api/feedback/stream${suffix}`, {
    headers: { accept: "text/event-stream" },
    signal,
    timeoutMs: null,
  });
  if (!response.ok) throw await failureFromResponse(response, client.baseUrl);
  if (response.body === null)
    throw new ArtifactsCliError("server", "The feedback stream had no body.");
  const reader = response.body.getReader();
  try {
    yield { type: "open" };
    const chunks = chunksWithWatchdog(
      reader,
      options.idleMs ?? STREAM_IDLE_MS,
      signal,
    );
    for await (const frame of parseSse(chunks)) {
      let json: unknown;
      try {
        json = JSON.parse(frame.data);
      } catch {
        continue;
      }
      const message = LiveMessageSchema.safeParse(json);
      if (message.success) yield { type: "message", message: message.data };
    }
  } finally {
    // Not awaited: cancelling a stream with a pending read can itself stall.
    void closeQuietly(reader);
  }
}

async function closeQuietly(reader: {
  cancel: () => Promise<void>;
}): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // Closing a stream that already ended or failed is best-effort.
  }
}
