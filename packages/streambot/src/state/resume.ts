import { formatTimecode } from "@shepherdjerred/streambot/discord/timecode.ts";
import type {
  PlaybackContext,
  PlaybackInput,
} from "@shepherdjerred/streambot/machine/types.ts";
import {
  sourceLabel,
  type Source,
} from "@shepherdjerred/streambot/sources/source.ts";
import type { PersistedState } from "@shepherdjerred/streambot/state/persistence.ts";

/**
 * Pure resume logic, split out of `index.ts` so it can be unit-tested without Discord clients or a
 * filesystem: turn live machine context into a {@link PersistedState} snapshot, turn a loaded
 * snapshot into the machine's start {@link PlaybackInput}, and phrase the back-online announcement.
 */

/** Stable, human-readable identity of a source — used to detect a resume that keeps crashing. */
export function resumeKeyFor(source: Source): string {
  switch (source.kind) {
    case "file":
      return `file:${source.path}`;
    case "url":
      return `url:${source.url}`;
    case "search":
      return `search:${source.query}`;
  }
}

/** Build a persistable snapshot from live machine context + the current playback position. */
export function buildSnapshot(params: {
  context: PlaybackContext;
  /** Live playback position (seconds); caller resolves null → a sensible fallback before calling. */
  positionSeconds: number;
  savedAt: number;
  resumeKey: string | null;
  resumeAttempts: number;
}): PersistedState {
  const { context, positionSeconds, savedAt, resumeKey, resumeAttempts } =
    params;
  return {
    version: 1,
    savedAt,
    guildId: context.guildId,
    channelId: context.channelId,
    loop: context.loop,
    volume: context.volume,
    current:
      context.current === null
        ? null
        : {
            source: context.current.source,
            requesterId: context.current.requesterId,
            ...(context.resolved?.title === undefined
              ? {}
              : { title: context.resolved.title }),
            positionSeconds: Math.max(0, Math.floor(positionSeconds)),
          },
    queue: context.queue.map((entry) => ({
      source: entry.source,
      requesterId: entry.requesterId,
    })),
    resumeAttempts,
    resumeKey,
  };
}

export type ResumeDecision = {
  /** The machine start input (queue/loop/volume/seek), with the in-progress item at queue[0]. */
  input: PlaybackInput;
  /** Whether we are resuming the in-progress item with a seek. */
  resumedCurrent: boolean;
  /** We had a saved in-progress item but skipped it because it kept crashing the bot. */
  droppedForCrashLoop: boolean;
  /** Resume identity + attempt count to persist on the first post-boot snapshot. */
  resumeKey: string | null;
  resumeAttempts: number;
};

/**
 * Decide how to start the machine from loaded state. The in-progress item, when kept, is placed at
 * `queue[0]` so the normal dequeue flow plays it first (with `initialSeekSeconds`). The current item
 * is dropped — falling back to the rest of the queue — when:
 *  - the saved guild or voice channel no longer matches config (reconfigured / stale state), which
 *    discards everything so we never resume into a stale channel; or
 *  - it has crashed the bot `maxResumeAttempts` times in a row (crash-loop guard).
 */
export function buildResumeInput(
  restored: PersistedState | null,
  base: PlaybackInput,
  opts: { maxResumeAttempts: number },
): ResumeDecision {
  if (
    restored?.guildId !== base.guildId ||
    restored.channelId !== base.channelId
  ) {
    return {
      input: base,
      resumedCurrent: false,
      droppedForCrashLoop: false,
      resumeKey: null,
      resumeAttempts: 0,
    };
  }

  const queue = restored.queue.map((entry) => ({
    source: entry.source,
    requesterId: entry.requesterId,
  }));

  const current = restored.current;
  const crashLooping =
    current !== null &&
    restored.resumeKey === resumeKeyFor(current.source) &&
    restored.resumeAttempts >= opts.maxResumeAttempts;

  if (current === null || crashLooping) {
    return {
      input: {
        ...base,
        initialQueue: queue,
        initialLoop: restored.loop,
        initialVolume: restored.volume,
      },
      resumedCurrent: false,
      droppedForCrashLoop: crashLooping,
      resumeKey: null,
      resumeAttempts: 0,
    };
  }

  const key = resumeKeyFor(current.source);
  const attempts =
    (restored.resumeKey === key ? restored.resumeAttempts : 0) + 1;
  return {
    input: {
      ...base,
      initialQueue: [
        { source: current.source, requesterId: current.requesterId },
        ...queue,
      ],
      initialLoop: restored.loop,
      initialVolume: restored.volume,
      initialSeekSeconds: current.positionSeconds,
    },
    resumedCurrent: true,
    droppedForCrashLoop: false,
    resumeKey: key,
    resumeAttempts: attempts,
  };
}

/**
 * The world-readable "I'm back" message, reflecting what was actually resumed. Returns null when
 * there's nothing to say (no state, or nothing to resume).
 */
export function buildResumeAnnouncement(
  restored: PersistedState | null,
  decision: ResumeDecision,
): string | null {
  if (restored === null) {
    return null;
  }

  if (decision.resumedCurrent && restored.current !== null) {
    const title =
      restored.current.title ?? sourceLabel(restored.current.source);
    return `🔄 I was offline for a moment — resuming **${title}** from ${formatTimecode(
      restored.current.positionSeconds,
    )}.`;
  }

  const queueCount = decision.input.initialQueue?.length ?? 0;
  const items = `${String(queueCount)} item${queueCount === 1 ? "" : "s"}`;

  if (decision.droppedForCrashLoop) {
    return queueCount > 0
      ? `🔄 I'm back online — couldn't safely resume the last video, continuing the queue (${items}).`
      : `🔄 I'm back online — couldn't safely resume the last video.`;
  }

  if (queueCount > 0) {
    return `🔄 I'm back online — restored the queue (${items}).`;
  }

  return null;
}
