import { assign, fromPromise, setup } from "xstate";
import {
  externalStopMessage,
  MACHINE_TYPES,
  MAX_CRASH_RETRIES,
  moveVoiceTargetUpdates,
  playNowWhileJoiningUpdates,
  queuedItem,
} from "@shepherdjerred/streambot/machine/playback-helpers.ts";
import type {
  JoinVoiceInput,
  LeaveVoiceInput,
  ResolveSourceInput,
  RunStreamInput,
} from "@shepherdjerred/streambot/machine/types.ts";

import type { PlaybackActors } from "./playback-actors.ts";

/**
 * Build the playback state machine — the single source of truth for the streaming lifecycle. All
 * I/O is delegated to the provided {@link PlaybackActors}, so the machine is pure and every
 * transition (queue edits, loop modes, skip/stop, blocked sources, crash recovery, wedge
 * timeouts, idle disconnect) is deterministically unit-testable.
 *
 * Flow: `idle → joining → advance → resolving → streaming → advance → … → waiting → leaving → idle`.
 * `advance` picks the next item per loop mode; `waiting` holds the voice connection for a grace
 * period before disconnecting; `failed` drops a bad/blocked item and continues (or bails on join
 * failure). A mid-stream death (crash / truncation / stall) re-queues the current item and
 * retries at the death position, walking the pipeline ladder (see MAX_CRASH_RETRIES).
 */
export function playbackSetup(actors: PlaybackActors) {
  return setup({
    types: MACHINE_TYPES,
    actors: {
      joinVoice: fromPromise(
        ({ input, signal }: { input: JoinVoiceInput; signal: AbortSignal }) =>
          actors.joinVoice(input, signal),
      ),
      resolveSource: fromPromise(
        ({
          input,
          signal,
        }: {
          input: ResolveSourceInput;
          signal: AbortSignal;
        }) => actors.resolveSource(input, signal),
      ),
      runStream: fromPromise(
        ({ input, signal }: { input: RunStreamInput; signal: AbortSignal }) =>
          actors.runStream(input, signal),
      ),
      leaveVoice: fromPromise(
        ({ input, signal }: { input: LeaveVoiceInput; signal: AbortSignal }) =>
          actors.leaveVoice(input, signal),
      ),
    },
    delays: {
      idleTimeout: ({ context }) => context.idleTimeoutMs,
      joinTimeout: ({ context }) => context.wedgeTimeoutsMs.join,
      resolveTimeout: ({ context }) => context.wedgeTimeoutsMs.resolve,
      leaveTimeout: ({ context }) => context.wedgeTimeoutsMs.leave,
    },
    guards: {
      hasQueue: ({ context }) => context.queue.length > 0,
      hasVoice: ({ context }) => context.voice !== null,
      isTrackReplay: ({ context }) =>
        context.loop === "track" && context.current !== null,
      isQueueLoopHasContent: ({ context }) =>
        context.loop === "queue" &&
        (context.current !== null || context.queue.length > 0),
      // A mid-stream death with retry budget left and an item to replay.
      isCrashRetryable: ({ context }) =>
        context.crashRetries < MAX_CRASH_RETRIES && context.current !== null,
      shouldStartPaused: ({ context }) =>
        context.startPaused && context.queue.length > 0,
    },
    actions: {
      dequeue: assign({
        current: ({ context }) => context.queue[0] ?? null,
        queue: ({ context }) => context.queue.slice(1),
      }),
      requeueCurrent: assign({
        queue: ({ context }) =>
          context.current === null
            ? context.queue
            : [...context.queue, context.current],
      }),
      clearCurrent: assign({ current: null }),
      clearQueue: assign({ queue: [] }),
      resetPlayback: assign({
        current: null,
        resolved: null,
        voice: null,
        pausedPositionSeconds: null,
      }),
      recordExternalStop: assign({
        lastError: ({ event }) => externalStopMessage(event),
        lastErrorKind: "generic",
      }),
      moveVoiceTarget: assign(({ context, event }) =>
        moveVoiceTargetUpdates(context, event),
      ),
      // Consume the one-shot resume seek so only the first post-restart playthrough seeks; any
      // loop/replay of the same item starts from 0.
      consumeSeek: assign({ resumeSeekSeconds: 0 }),
      // The current item finished, was skipped, or playback stopped: its recovery budget resets.
      resetCrashRetries: assign({ crashRetries: 0 }),
      completeStream: assign({
        crashRetries: 0,
        completedStreams: ({ context }) => context.completedStreams + 1,
      }),
      // Clear ALL crash/stall recovery state (resume seek + retry budget). Applied to every
      // non-success exit from `resolving` so a recovery re-resolve that fails via ANY path
      // (reject, wedge timeout, SKIP, STOP) can't leak the crashed item's seek offset or escalated
      // pipeline onto the next dequeued item. The success path (`resolving → streaming`) must NOT
      // clear these — streaming consumes resumeSeekSeconds (via its `consumeSeek` exit) and picks
      // its pipeline from crashRetries — so this is applied per-transition, not as a state exit.
      clearRecovery: assign({ resumeSeekSeconds: 0, crashRetries: 0 }),
      playNow: assign(({ event }) => ({
        current: queuedItem(event),
        resolved: null,
        resumeSeekSeconds: 0,
        pausedPositionSeconds: null,
        crashRetries: 0,
        startPaused: false,
      })),
      queuePlayNow: assign(({ event }) => ({
        queue: [queuedItem(event)],
        current: null,
        resolved: null,
        resumeSeekSeconds: 0,
        pausedPositionSeconds: null,
        crashRetries: 0,
        startPaused: false,
      })),
      playNowWhileJoining: assign(({ context, event }) =>
        playNowWhileJoiningUpdates(context, event),
      ),
    },
  });
}
