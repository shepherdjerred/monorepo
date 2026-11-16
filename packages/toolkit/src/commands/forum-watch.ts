import { z } from "zod";
import {
  ForumKindSchema,
  ForumPostIdOrIdentifierSchema,
  LiveMessageSchema,
  type LiveChange,
} from "@shepherdjerred/tracker/contract";
import type { TrackerCommandContext } from "./tracker/issues.ts";
import type { ForumOptions } from "./forum-options.ts";

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
};

type FrameWatcher = {
  context: TrackerCommandContext;
  targetUuid: string | undefined;
  config: WatchConfig;
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

async function handleForumFrame(
  data: string,
  watcher: FrameWatcher,
): Promise<boolean> {
  const parsed = LiveMessageSchema.parse(JSON.parse(data));
  if (parsed.type === "resync") return false;
  if (!parsed.entityType.startsWith("forum")) return false;
  if (
    watcher.targetUuid !== undefined &&
    parsed.entityId !== watcher.targetUuid
  )
    return false;
  const post = await watcher.context.client.forum.byId.query({
    id: parsed.entityId,
  });
  if (watcher.isAborted() || !matchesWatchFilters(post, watcher.config))
    return false;
  watcher.emit(formatWatchLine(parsed, post, watcher.config.json));
  return (
    watcher.config.once ||
    (watcher.config.untilResolved && post.state === "resolved")
  );
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
    const baseUrl = context.url.replace(/\/$/u, "");
    const response = await fetch(`${baseUrl}/api/events/stream`, {
      headers: { Accept: "text/event-stream" },
      signal: controller.signal,
    });
    if (!response.ok || response.body === null) {
      throw new Error(
        `Forum event stream failed (HTTP ${String(response.status)})`,
      );
    }
    const target = await resolveInitialTarget(context, config, emit);
    if (target.alreadyDone) {
      completed = true;
      controller.abort();
      return;
    }
    const watcher: FrameWatcher = {
      context,
      targetUuid: target.targetUuid,
      config,
      isAborted: () => controller.signal.aborted,
      emit,
    };
    completed = await readSseFrames(response.body, (data) =>
      handleForumFrame(data, watcher),
    );
    if (completed) controller.abort();
  } catch (error) {
    if (config.timeoutSec !== undefined && state.timedOut) {
      throw new Error(
        `Timed out after ${String(config.timeoutSec)}s waiting for forum events`,
        { cause: error },
      );
    }
    if (!completed && !state.stoppedBySignal) throw error;
  } finally {
    cleanup();
  }
  if (config.timeoutSec !== undefined && state.timedOut) {
    throw new Error(
      `Timed out after ${String(config.timeoutSec)}s waiting for forum events`,
    );
  }
  if (
    !completed &&
    !state.stoppedBySignal &&
    (config.once || config.untilResolved)
  ) {
    throw new Error("Forum event stream closed before exit condition was met");
  }
}
