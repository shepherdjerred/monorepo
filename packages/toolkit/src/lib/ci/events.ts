import { z } from "zod";
import { sleep } from "./wait/sleep.ts";
import { workflowStatus } from "./status.ts";
import {
  WoodpeckerHttpError,
  isPrVerificationPipeline,
  type WoodpeckerConfig,
} from "#lib/woodpecker/ci.ts";

const EventSchema = z.object({
  repo: z.object({ id: z.number() }),
  pipeline: z.object({
    number: z.number(),
    commit: z.string(),
    event: z.string(),
    status: z.string(),
    event_reason: z.array(z.string()).nullish(),
    pr_draft: z.boolean().optional(),
    ref: z.string(),
    branch: z.string(),
  }),
});

export class SseDecoder {
  readonly #decoder = new TextDecoder();
  #buffer = "";
  #lines: string[] = [];
  #size = 0;
  push(chunk: Uint8Array): string[] {
    this.#buffer += this.#decoder.decode(chunk, { stream: true });
    if (this.#buffer.length > 4_000_000)
      throw new Error("Woodpecker event frame exceeds its size limit");
    const frames: string[] = [];
    let end = this.#buffer.indexOf("\n");
    while (end >= 0) {
      const line = this.#buffer.slice(0, end).replace(/\r$/, "");
      this.#buffer = this.#buffer.slice(end + 1);
      const frame = this.line(line);
      if (frame !== null) frames.push(frame);
      end = this.#buffer.indexOf("\n");
    }
    return frames;
  }
  private line(line: string): string | null {
    if (line === "") {
      const frame = this.#lines.length > 0 ? this.#lines.join("\n") : null;
      this.#lines = [];
      this.#size = 0;
      return frame;
    }
    if (!line.startsWith("data:")) return null;
    this.#size += line.length;
    if (this.#size > 4_000_000)
      throw new Error("Woodpecker event frame exceeds its size limit");
    this.#lines.push(line.slice(5).replace(/^ /, ""));
    return null;
  }
}

/** Incremental SSE framing, including UTF-8 chunks, CRLF, and comment heartbeats. */
export async function* eventFrames(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new SseDecoder();
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) return;
      yield* decoder.push(part.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

export type EventWatch = {
  signal: AbortSignal;
  wake: () => void;
  connected: () => void;
  fatal: (error: unknown) => void;
  /**
   * The PR whose pipelines wake the wait; null watches main only. A PR wait
   * wakes for main only when a main pipeline finishes: main's verdict matters
   * to a PR only once it settles, and its step events would otherwise wake
   * every PR waiter several times a minute.
   */
  prNumber: number | null;
  /** Called with the commit of each event for the watched PR. */
  prCommit?: (commit: string) => void;
};

function isCancelled(signal: AbortSignal): boolean {
  return signal.aborted;
}
function terminalError(error: unknown): boolean {
  if (error instanceof z.ZodError || error instanceof SyntaxError) return true;
  return error instanceof WoodpeckerHttpError
    ? error.status < 500 && error.status !== 429
    : error instanceof Error &&
        /invalid contract|size limit/.test(error.message);
}

async function consumeEvents(
  config: WoodpeckerConfig,
  watch: EventWatch,
): Promise<void> {
  const response = await fetch(new URL("/api/stream/events", config.baseUrl), {
    headers: { authorization: `Bearer ${config.token}` },
    redirect: "error",
    signal: watch.signal,
  });
  if (!response.ok)
    throw new WoodpeckerHttpError(response.status, "/api/stream/events");
  if (
    response.headers.get("content-type")?.includes("text/event-stream") !==
      true ||
    response.body === null
  )
    throw new Error("Woodpecker event stream returned an invalid contract");
  watch.connected();
  watch.wake();
  for await (const frame of eventFrames(response.body)) {
    const event = EventSchema.parse(JSON.parse(frame));
    if (event.repo.id !== config.repoId) continue;
    const relevantPr =
      watch.prNumber !== null &&
      isPrVerificationPipeline(event.pipeline) &&
      event.pipeline.ref.startsWith(`refs/pull/${String(watch.prNumber)}/`);
    const mainEvent =
      (event.pipeline.event === "push" || event.pipeline.event === "manual") &&
      event.pipeline.branch === "main" &&
      event.pipeline.ref === "refs/heads/main";
    const relevantMain =
      mainEvent &&
      (watch.prNumber === null ||
        workflowStatus(event.pipeline.status) !== "PENDING");
    if (relevantPr) watch.prCommit?.(event.pipeline.commit);
    if (relevantPr || relevantMain) watch.wake();
  }
}

/** Open before the first snapshot; reconnects always request a fresh snapshot. */
export async function watchEvents(
  config: WoodpeckerConfig,
  watch: EventWatch,
): Promise<void> {
  let backoff = 1000;
  while (!isCancelled(watch.signal)) {
    try {
      await consumeEvents(config, watch);
      backoff = 1000;
    } catch (error) {
      if (isCancelled(watch.signal)) return;
      if (terminalError(error)) {
        watch.fatal(error);
        return;
      }
    }
    watch.wake();
    try {
      await sleep(backoff, watch.signal);
    } catch (error) {
      if (isCancelled(watch.signal)) return;
      throw error;
    }
    backoff = Math.min(backoff * 2, 30_000);
  }
}
