import { isTRPCClientError } from "@trpc/client";
import { z } from "zod";
import {
  ForumKindSchema,
  ForumPostIdOrIdentifierSchema,
  LiveMessageSchema,
  type LiveChange,
} from "@shepherdjerred/tracker/contract";
import type { TrackerCommandContext } from "./tracker/issues.ts";
import type { ForumOptions } from "./forum-options.ts";

const DEFAULT_INITIAL_RECONNECT_MS = 250;
const DEFAULT_MAX_RECONNECT_MS = 5000;
const MAX_TRACKED_EVENT_IDS = 10_000;

const NON_RETRYABLE_TRPC_CODES = new Set([
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "METHOD_NOT_SUPPORTED",
  "UNPROCESSABLE_CONTENT",
]);

const TrpcFailureMetadataSchema = z.object({
  data: z
    .object({
      httpStatus: z.number().optional(),
      code: z.string().optional(),
    })
    .optional(),
  meta: z
    .object({
      response: z.object({ status: z.number().optional() }).optional(),
    })
    .optional(),
});

type ForumKind = z.infer<typeof ForumKindSchema>;
type WatchedPost = Awaited<
  ReturnType<TrackerCommandContext["client"]["forum"]["byId"]["query"]>
>;

type WatchConfig = {
  targetId: string | undefined;
  kind: ForumKind | undefined;
  scopes: string[];
  once: boolean;
  untilResolved: boolean;
  timeoutSec: number | undefined;
  json: boolean;
};

export type WatchRuntimeOptions = {
  signal?: AbortSignal | undefined;
  writeLine?: ((line: string) => void) | undefined;
  initialReconnectDelayMs?: number | undefined;
  maxReconnectDelayMs?: number | undefined;
};

type FrameWatcher = {
  context: TrackerCommandContext;
  targetUuid: string | undefined;
  config: WatchConfig;
  seenEventIds: Set<string>;
  sawInitialResync: boolean;
  isAborted: () => boolean;
  emit: (line: string) => void;
};

function parseWatchConfig(args: string[], options: ForumOptions): WatchConfig {
  if (options["until-resolved"] && args[0] === undefined)
    throw new Error("--until-resolved requires a post ID");
  return {
    targetId:
      args[0] === undefined
        ? undefined
        : ForumPostIdOrIdentifierSchema.parse(args[0]),
    kind:
      options.kind === undefined
        ? undefined
        : ForumKindSchema.parse(options.kind),
    scopes: options.scope ?? [],
    once: options.once,
    untilResolved: options["until-resolved"],
    timeoutSec:
      options["timeout-sec"] === undefined
        ? undefined
        : z.coerce.number().int().positive().parse(options["timeout-sec"]),
    json: options.json,
  };
}

type ChangeEvent = LiveChange & { type: "change" };

function formatWatchLine(
  event: ChangeEvent,
  post: WatchedPost,
  json: boolean,
): string {
  return json
    ? JSON.stringify({ event, post })
    : `[${event.occurredAt}] ${post.identifier} (${post.kind}/${post.state}) ${event.action}: ${post.title}`;
}

function matchesWatchFilters(post: WatchedPost, config: WatchConfig): boolean {
  return (
    (config.kind === undefined || post.kind === config.kind) &&
    (config.scopes.length === 0 ||
      post.scopes.length === 0 ||
      post.scopes.some((scope) => config.scopes.includes(scope)))
  );
}

async function resolveInitialTarget(
  context: TrackerCommandContext,
  config: WatchConfig,
  emit: (line: string) => void,
): Promise<{
  alreadyDone: boolean;
  targetUuid: string | undefined;
  targetIdentifier: string | undefined;
}> {
  if (config.targetId === undefined) {
    return {
      alreadyDone: false,
      targetUuid: undefined,
      targetIdentifier: undefined,
    };
  }
  const initial = await context.client.forum.byId.query({
    id: config.targetId,
  });
  if (config.untilResolved && initial.state === "resolved") {
    const occurredAt = initial.resolvedAt ?? initial.lastActivityAt;
    const snapshotEvent: ChangeEvent = {
      type: "change",
      eventId: `snapshot:${initial.id}`,
      entityType: "forum-post",
      entityId: initial.id,
      issueIdentifier: null,
      action: "already-resolved",
      actorId: initial.resolver?.id ?? initial.creator.id,
      requestId: "snapshot",
      occurredAt,
    };
    emit(formatWatchLine(snapshotEvent, initial, config.json));
    return {
      alreadyDone: true,
      targetUuid: initial.id,
      targetIdentifier: initial.identifier,
    };
  }
  return {
    alreadyDone: false,
    targetUuid: initial.id,
    targetIdentifier: initial.identifier,
  };
}

function consumeSseLine(line: string, dataLines: string[]): string | undefined {
  if (line === "") {
    if (dataLines.length === 0) return undefined;
    const payload = dataLines.join("\n");
    dataLines.length = 0;
    return payload;
  }
  if (line.startsWith(":")) return undefined;
  const colon = line.indexOf(":");
  const field = colon === -1 ? line : line.slice(0, colon);
  if (field !== "data") return undefined;
  const rawValue = colon === -1 ? "" : line.slice(colon + 1);
  dataLines.push(rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue);
  return undefined;
}

async function readSseFrames(
  body: ReadableStream<Uint8Array>,
  onFrame: (data: string) => Promise<boolean>,
): Promise<boolean> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const dataLines: string[] = [];
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return false;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const rawLine = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        const payload = consumeSseLine(line, dataLines);
        if (payload !== undefined && (await onFrame(payload))) return true;
        newline = buffer.indexOf("\n");
      }
    }
  } finally {
    await reader.cancel().catch(() => {
      /* Stream cleanup on exit or abort is best-effort. */
    });
  }
}

function rememberEventId(seen: Set<string>, eventId: string): boolean {
  if (seen.has(eventId)) return false;
  if (seen.size >= MAX_TRACKED_EVENT_IDS) {
    const oldest = seen.values().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
  seen.add(eventId);
  return true;
}

async function handleResyncFrame(watcher: FrameWatcher): Promise<boolean> {
  if (!watcher.sawInitialResync) {
    watcher.sawInitialResync = true;
    return false;
  }
  if (!watcher.config.untilResolved || watcher.isAborted()) return false;
  const target = await resolveInitialTarget(
    watcher.context,
    watcher.config,
    watcher.emit,
  );
  return target.alreadyDone;
}

async function handleForumFrame(
  data: string,
  watcher: FrameWatcher,
): Promise<boolean> {
  const parsed = LiveMessageSchema.parse(JSON.parse(data));
  if (parsed.type === "resync") return handleResyncFrame(watcher);
  if (!parsed.entityType.startsWith("forum")) return false;
  if (
    watcher.targetUuid !== undefined &&
    parsed.entityId !== watcher.targetUuid
  )
    return false;
  if (watcher.seenEventIds.has(parsed.eventId)) return false;
  const post = await watcher.context.client.forum.byId.query({
    id: parsed.entityId,
  });
  if (watcher.isAborted() || !matchesWatchFilters(post, watcher.config))
    return false;
  if (!rememberEventId(watcher.seenEventIds, parsed.eventId)) return false;
  watcher.emit(formatWatchLine(parsed, post, watcher.config.json));
  return (
    watcher.config.once ||
    (watcher.config.untilResolved && post.state === "resolved")
  );
}

class ForumStreamHttpError extends Error {
  readonly retryable: boolean;

  constructor(status: number, missingBody = false) {
    super(`Forum event stream failed (HTTP ${String(status)})`);
    this.retryable =
      missingBody || status >= 500 || status === 408 || status === 429;
  }
}

function isClientHttpStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

function isRetryableWatchError(error: unknown): boolean {
  if (error instanceof ForumStreamHttpError) return error.retryable;
  if (error instanceof z.ZodError || error instanceof SyntaxError) return false;
  if (!isTRPCClientError(error)) return true;
  const parsed = TrpcFailureMetadataSchema.safeParse(error);
  if (!parsed.success) return true;
  const status =
    parsed.data.data?.httpStatus ?? parsed.data.meta?.response?.status;
  if (status !== undefined && isClientHttpStatus(status)) return false;
  const code = parsed.data.data?.code;
  return code === undefined || !NON_RETRYABLE_TRPC_CODES.has(code);
}

function sleepWithAbort(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function createWatchAbort(
  timeoutSec: number | undefined,
  externalSignal: AbortSignal | undefined,
) {
  const controller = new AbortController();
  const state = { timedOut: false, stoppedBySignal: false };
  const onSignal = () => {
    state.stoppedBySignal = true;
    controller.abort();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  externalSignal?.addEventListener("abort", onSignal, { once: true });
  const timer =
    timeoutSec === undefined
      ? undefined
      : setTimeout(() => {
          state.timedOut = true;
          controller.abort();
        }, timeoutSec * 1000);
  return {
    controller,
    state,
    cleanup: () => {
      if (timer !== undefined) clearTimeout(timer);
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      externalSignal?.removeEventListener("abort", onSignal);
    },
  };
}

type StreamSessionOptions = {
  context: TrackerCommandContext;
  config: WatchConfig;
  seenEventIds: Set<string>;
  signal: AbortSignal;
  emit: (line: string) => void;
  onStreamOpened: () => void;
};

async function runWatchStreamOnce(
  session: StreamSessionOptions,
): Promise<boolean> {
  const baseUrl = session.context.url.replace(/\/$/u, "");
  const response = await fetch(`${baseUrl}/api/events/stream`, {
    headers: { Accept: "text/event-stream" },
    signal: session.signal,
  });
  if (!response.ok || response.body === null) {
    throw new ForumStreamHttpError(response.status, response.body === null);
  }
  session.onStreamOpened();
  const target = await resolveInitialTarget(
    session.context,
    session.config,
    session.emit,
  );
  if (target.alreadyDone) return true;
  const watcher: FrameWatcher = {
    context: session.context,
    targetUuid: target.targetUuid,
    config: session.config,
    seenEventIds: session.seenEventIds,
    sawInitialResync: false,
    isAborted: () => session.signal.aborted,
    emit: session.emit,
  };
  return readSseFrames(response.body, (data) =>
    handleForumFrame(data, watcher),
  );
}

async function runWatchLoop(params: {
  context: TrackerCommandContext;
  config: WatchConfig;
  controller: AbortController;
  isAborted: () => boolean;
  emit: (line: string) => void;
  initialDelayMs: number;
  maxDelayMs: number;
}): Promise<boolean> {
  let delayMs = params.initialDelayMs;
  const seenEventIds = new Set<string>();
  while (!params.isAborted()) {
    try {
      const done = await runWatchStreamOnce({
        context: params.context,
        config: params.config,
        seenEventIds,
        signal: params.controller.signal,
        emit: params.emit,
        onStreamOpened: () => {
          delayMs = params.initialDelayMs;
        },
      });
      if (done) {
        params.controller.abort();
        return true;
      }
    } catch (error) {
      if (params.isAborted() || !isRetryableWatchError(error)) {
        throw error;
      }
    }
    await sleepWithAbort(delayMs, params.controller.signal);
    delayMs = Math.min(params.maxDelayMs, delayMs * 2);
  }
  return false;
}

export async function watchForum(
  context: TrackerCommandContext,
  args: string[],
  options: ForumOptions,
  runtime?: WatchRuntimeOptions,
): Promise<void> {
  const config = parseWatchConfig(args, options);
  const emit = (line: string) => {
    if (runtime?.writeLine === undefined) console.log(line);
    else runtime.writeLine(line);
  };
  const { controller, state, cleanup } = createWatchAbort(
    config.timeoutSec,
    runtime?.signal,
  );
  let completed = false;
  try {
    completed = await runWatchLoop({
      context,
      config,
      controller,
      isAborted: () => controller.signal.aborted,
      emit,
      initialDelayMs:
        runtime?.initialReconnectDelayMs ?? DEFAULT_INITIAL_RECONNECT_MS,
      maxDelayMs: runtime?.maxReconnectDelayMs ?? DEFAULT_MAX_RECONNECT_MS,
    });
  } catch (error) {
    if (config.timeoutSec !== undefined && state.timedOut) {
      throw new Error(
        `Timed out after ${String(config.timeoutSec)}s waiting for forum events`,
        { cause: error },
      );
    }
    if (!state.stoppedBySignal) throw error;
  } finally {
    cleanup();
  }
  if (!completed && config.timeoutSec !== undefined && state.timedOut) {
    throw new Error(
      `Timed out after ${String(config.timeoutSec)}s waiting for forum events`,
    );
  }
}
