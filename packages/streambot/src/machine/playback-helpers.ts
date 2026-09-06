/**
 * Pure helpers for the playback machine: context invariants, external-stop messages, and the
 * crash-recovery context updaters. Everything here is side-effect-free so the machine file stays
 * focused on states/transitions and each updater is unit-testable through the machine tests.
 */
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { BlockedSourceError } from "@shepherdjerred/streambot/moderation/adult-block.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";
import { StreamCrashError } from "@shepherdjerred/streambot/streamer/stream-errors.ts";
import type {
  CrashReason,
  PipelineMode,
  PlaybackContext,
  PlaybackEvent,
  PlaybackInput,
  QueuedSource,
  ResolvedSource,
  VoiceHandle,
} from "@shepherdjerred/streambot/machine/types.ts";

// Branded placeholders for the XState `types` phantom (never read at runtime).
const PLACEHOLDER_GUILD = GuildIdSchema.parse("000000000000000000");
const PLACEHOLDER_CHANNEL = ChannelIdSchema.parse("000000000000000000");

/**
 * Bounded in-process recovery for a stream segment that dies mid-playback (crash, exit-0
 * truncation, or stall): re-queue the current item at the head and replay it from the position it
 * died at, walking the pipeline ladder — attempts 0-1 full hardware, attempt 2 hw-upload (immune
 * to ffmpeg's mid-stream hwaccel-flip crash, still GPU tonemap/encode), attempt 3 software.
 * Exhausted → `failed` (drop the item, announce, continue with the queue).
 */
export const MAX_CRASH_RETRIES = 3;

/** Pipeline the given attempt runs on (attempt = context.crashRetries at invoke time). */
export function pipelineForAttempt(crashRetries: number): PipelineMode {
  if (crashRetries <= 1) return "hw";
  if (crashRetries === 2) return "hw-upload";
  return "sw";
}

// Wedge guards: no invoked actor may hold its state forever. The state-exit AbortSignal fired by
// these `after` transitions also cancels the hung work (yt-dlp subprocess, voice handshake).
export const JOIN_TIMEOUT_MS = 30_000;
export const RESOLVE_TIMEOUT_MS = 60_000;
export const LEAVE_TIMEOUT_MS = 10_000;

export const EXTERNAL_STOP_TRANSITIONS = [
  {
    guard: "hasVoice" as const,
    target: "#playback.leaving" as const,
    actions: ["clearQueue" as const, "recordExternalStop" as const],
  },
  {
    target: "#playback.idle" as const,
    actions: ["clearQueue" as const, "recordExternalStop" as const],
  },
];

export function initialPlaybackContext(input: PlaybackInput): PlaybackContext {
  return {
    guildId: input.guildId,
    channelId: input.channelId,
    idleTimeoutMs: input.idleTimeoutMs,
    wedgeTimeoutsMs: {
      join: input.wedgeTimeoutsMs?.join ?? JOIN_TIMEOUT_MS,
      resolve: input.wedgeTimeoutsMs?.resolve ?? RESOLVE_TIMEOUT_MS,
      leave: input.wedgeTimeoutsMs?.leave ?? LEAVE_TIMEOUT_MS,
    },
    queue: input.initialQueue ?? [],
    current: null,
    voice: null,
    resolved: null,
    loop: input.initialLoop ?? "off",
    volume: input.initialVolume ?? 100,
    lastError: null,
    lastErrorKind: null,
    blockedNonce: 0,
    lastBlockedRequester: null,
    resumeSeekSeconds: input.initialSeekSeconds ?? 0,
    crashRetries: 0,
    crashNotice: null,
    pausedPositionSeconds: null,
    startPaused: input.initialPaused ?? false,
  };
}

/** The XState `types` phantom for setup() (never read at runtime). */
export const MACHINE_TYPES: {
  context: PlaybackContext;
  events: PlaybackEvent;
  input: PlaybackInput;
} = {
  context: {
    guildId: PLACEHOLDER_GUILD,
    channelId: PLACEHOLDER_CHANNEL,
    idleTimeoutMs: 0,
    wedgeTimeoutsMs: {
      join: JOIN_TIMEOUT_MS,
      resolve: RESOLVE_TIMEOUT_MS,
      leave: LEAVE_TIMEOUT_MS,
    },
    queue: [],
    current: null,
    voice: null,
    resolved: null,
    loop: "off",
    volume: 100,
    lastError: null,
    lastErrorKind: null,
    blockedNonce: 0,
    lastBlockedRequester: null,
    resumeSeekSeconds: 0,
    crashRetries: 0,
    crashNotice: null,
    pausedPositionSeconds: null,
    startPaused: false,
  },
  events: { type: "SKIP" },
  input: {
    guildId: PLACEHOLDER_GUILD,
    channelId: PLACEHOLDER_CHANNEL,
    idleTimeoutMs: 0,
  },
};

export function mustCurrent(
  context: PlaybackContext,
): NonNullable<PlaybackContext["current"]> {
  if (context.current === null) {
    throw new Error("invariant: no current source while resolving");
  }
  return context.current;
}

export function mustVoice(context: PlaybackContext): VoiceHandle {
  if (context.voice === null) {
    throw new Error("invariant: no voice connection");
  }
  return context.voice;
}

export function mustResolved(context: PlaybackContext): ResolvedSource {
  if (context.resolved === null) {
    throw new Error("invariant: no resolved source while streaming");
  }
  return context.resolved;
}

const EXTERNAL_STOP_MESSAGES: ReadonlyMap<PlaybackEvent["type"], string> =
  new Map([
    ["GUILD_REMOVED", "guild removed"],
    ["CHANNEL_DELETED", "voice channel deleted"],
  ]);

export function externalStopMessage(event: PlaybackEvent): string {
  if (event.type === "STREAMER_VOICE_DETACHED") {
    return event.reason ?? "streamer voice detached";
  }
  if (event.type === "PRODUCER_FAILED") {
    return event.reason;
  }
  return EXTERNAL_STOP_MESSAGES.get(event.type) ?? "external stream event";
}

/** Narrow an unknown actor error to a {@link StreamCrashError}, or null. */
export function streamCrashFrom(error: unknown): StreamCrashError | null {
  return error instanceof StreamCrashError ? error : null;
}

/** A queue entry from an ADD/ADD_NEXT event payload. */
export function queuedItem(event: PlaybackEvent): QueuedSource {
  if (
    event.type !== "ADD" &&
    event.type !== "ADD_NEXT" &&
    event.type !== "PLAY_NOW"
  ) {
    throw new Error(`Cannot build a queued item from ${event.type}`);
  }
  return {
    source: event.source,
    requesterId: event.requesterId,
    ...(event.requestId === undefined ? {} : { requestId: event.requestId }),
    ...(event.preResolved === undefined
      ? {}
      : { preResolved: event.preResolved }),
  };
}

export function playNowWhileJoiningUpdates(
  context: PlaybackContext,
  event: PlaybackEvent,
): Partial<PlaybackContext> {
  if (event.type !== "PLAY_NOW") {
    throw new Error("playNowWhileJoiningUpdates received a non-play event");
  }
  return {
    queue: [queuedItem(event), ...context.queue],
    current: null,
    resolved: null,
    resumeSeekSeconds: 0,
    pausedPositionSeconds: null,
    crashRetries: 0,
    startPaused: false,
  };
}

/** Context updates that re-queue the current item for a recovery retry at `positionSeconds`. */
export function queueCrashRetryUpdates(
  context: PlaybackContext,
  info: { reason: CrashReason; positionSeconds: number },
): Partial<PlaybackContext> {
  const current = mustCurrent(context);
  const attempt = context.crashRetries + 1;
  return {
    queue: [
      {
        source: current.source,
        requesterId: current.requesterId,
        ...(current.requestId === undefined
          ? {}
          : { requestId: current.requestId }),
      },
      ...context.queue,
    ],
    resumeSeekSeconds: Math.max(0, Math.floor(info.positionSeconds)),
    crashRetries: attempt,
    crashNotice: {
      nonce: (context.crashNotice?.nonce ?? 0) + 1,
      kind: "retry",
      reason: info.reason,
      title: mustResolved(context).title,
      positionSeconds: info.positionSeconds,
      attempt,
      maxAttempts: MAX_CRASH_RETRIES,
      pipelineMode: pipelineForAttempt(attempt),
    },
  };
}

/** Context updates for abandoning a crashing item after the retry budget is spent. */
export function crashGiveUpUpdates(
  context: PlaybackContext,
  info: { reason: CrashReason; positionSeconds: number; lastError: string },
): Partial<PlaybackContext> {
  return {
    lastError: info.lastError,
    lastErrorKind: info.reason === "stall" ? "stall" : "crash",
    crashRetries: 0,
    crashNotice: {
      nonce: (context.crashNotice?.nonce ?? 0) + 1,
      kind: "gave-up",
      reason: info.reason,
      title: context.resolved?.title ?? "unknown",
      positionSeconds: info.positionSeconds,
      attempt: context.crashRetries,
      maxAttempts: MAX_CRASH_RETRIES,
      pipelineMode: pipelineForAttempt(context.crashRetries),
    },
  };
}

/** Terminal stream-error updates: crash give-up when the budget is spent, plain error otherwise. */
export function streamErrorUpdates(
  context: PlaybackContext,
  error: unknown,
): Partial<PlaybackContext> {
  const crash = streamCrashFrom(error);
  if (crash !== null) {
    return crashGiveUpUpdates(context, {
      reason: crash.kind,
      positionSeconds: crash.positionSeconds,
      lastError: getErrorMessage(crash),
    });
  }
  return {
    lastError: getErrorMessage(error),
    lastErrorKind: "generic",
    crashRetries: 0,
  };
}

/**
 * Successful resolve: stage the source and drop the one-shot pre-resolved payload so any later
 * replay of this same queued item (track loop, requeue, crash retry) re-resolves for real instead
 * of reusing a possibly-expired URL.
 */
export function resolveDoneUpdates(
  context: PlaybackContext,
  resolved: ResolvedSource,
): Partial<PlaybackContext> {
  return {
    resolved,
    lastError: null,
    lastErrorKind: null,
    current: {
      source: mustCurrent(context).source,
      requesterId: mustCurrent(context).requesterId,
      ...(mustCurrent(context).requestId === undefined
        ? {}
        : { requestId: mustCurrent(context).requestId }),
    },
  };
}

/** Failed resolve: record the error; blocked (adult) sources additionally bump the shame nonce. */
export function resolveErrorUpdates(
  context: PlaybackContext,
  error: unknown,
): Partial<PlaybackContext> {
  const blocked = error instanceof BlockedSourceError;
  return {
    lastError: getErrorMessage(error),
    lastErrorKind: blocked ? "blocked" : "generic",
    blockedNonce: blocked ? context.blockedNonce + 1 : context.blockedNonce,
    lastBlockedRequester: blocked
      ? (context.current?.requesterId ?? null)
      : context.lastBlockedRequester,
  };
  // NOTE: recovery-state cleanup (resumeSeekSeconds/crashRetries) is NOT done here. It is applied
  // uniformly by the machine's `clearRecovery` action on EVERY non-success exit from `resolving`
  // (onError, resolveTimeout, SKIP, STOP), so a re-resolve that fails via any of those paths — not
  // just this one — can't leak the crashed item's seek/pipeline onto the next queued item.
}

/** Admin moved the voice target: retarget the context (and live handle, when joined). */
export function moveVoiceTargetUpdates(
  context: PlaybackContext,
  event: PlaybackEvent,
): Partial<PlaybackContext> {
  if (event.type !== "VOICE_TARGET_MOVED") {
    return {};
  }
  const guildId = GuildIdSchema.parse(event.target.guildId);
  const channelId = ChannelIdSchema.parse(event.target.channelId);
  return {
    guildId,
    channelId,
    voice: context.voice === null ? null : { guildId, channelId },
  };
}
