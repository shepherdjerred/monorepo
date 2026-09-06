import { assign, fromPromise, setup } from "xstate";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import {
  moveItem,
  removeAt,
  shuffleQueue,
} from "@shepherdjerred/streambot/machine/queue-ops.ts";
import { withSubtitles } from "@shepherdjerred/streambot/sources/source.ts";
import {
  crashGiveUpUpdates,
  EXTERNAL_STOP_TRANSITIONS,
  externalStopMessage,
  initialPlaybackContext,
  MACHINE_TYPES,
  MAX_CRASH_RETRIES,
  moveVoiceTargetUpdates,
  mustCurrent,
  mustResolved,
  mustVoice,
  pipelineForAttempt,
  queueCrashRetryUpdates,
  queuedItem,
  resolveDoneUpdates,
  resolveErrorUpdates,
  streamCrashFrom,
  streamErrorUpdates,
} from "@shepherdjerred/streambot/machine/playback-helpers.ts";
import type {
  JoinVoiceInput,
  LeaveVoiceInput,
  ResolvedSource,
  ResolveSourceInput,
  RunStreamInput,
  VoiceHandle,
} from "@shepherdjerred/streambot/machine/types.ts";

/**
 * The side-effecting operations the machine drives. Implementations live in the streamer/sources
 * layers (real) or are stubbed in tests. Each receives an {@link AbortSignal} that fires when the
 * machine leaves the invoking state (SKIP/STOP) so I/O cancels promptly.
 */
export type PlaybackActors = {
  joinVoice: (
    input: JoinVoiceInput,
    signal: AbortSignal,
  ) => Promise<VoiceHandle>;
  resolveSource: (
    input: ResolveSourceInput,
    signal: AbortSignal,
  ) => Promise<ResolvedSource>;
  /** Resolves when the stream ends naturally; rejects on stream error (typed for crashes). */
  runStream: (input: RunStreamInput, signal: AbortSignal) => Promise<void>;
  leaveVoice: (input: LeaveVoiceInput, signal: AbortSignal) => Promise<void>;
};

const VOLUME_MIN = 0;
const VOLUME_MAX = 200;

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
function playbackSetup(actors: PlaybackActors) {
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
    },
  });
}

export function createPlaybackMachine(actors: PlaybackActors) {
  return playbackSetup(actors).createMachine({
    id: "playback",
    context: ({ input }) => initialPlaybackContext(input),
    initial: "idle",
    // Queue-editing events are accepted in every state (they only touch context).
    on: {
      ADD: {
        actions: assign({
          queue: ({ context, event }) => [...context.queue, queuedItem(event)],
        }),
      },
      ADD_NEXT: {
        actions: assign({
          queue: ({ context, event }) => [queuedItem(event), ...context.queue],
        }),
      },
      PLAY_NOW: { actions: "queuePlayNow" },
      REMOVE: {
        actions: assign({
          queue: ({ context, event }) => removeAt(context.queue, event.index),
        }),
      },
      CLEAR: { actions: "clearQueue" },
      MOVE: {
        actions: assign({
          queue: ({ context, event }) =>
            moveItem(context.queue, event.from, event.to),
        }),
      },
      SHUFFLE: {
        actions: assign({
          queue: ({ context }) => shuffleQueue(context.queue),
        }),
      },
      SET_LOOP: { actions: assign({ loop: ({ event }) => event.mode }) },
      SET_VOLUME: {
        actions: assign({
          volume: ({ event }) =>
            Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, event.volume)),
        }),
      },
      VOICE_TARGET_MOVED: { actions: "moveVoiceTarget" },
      STREAMER_VOICE_DETACHED: EXTERNAL_STOP_TRANSITIONS,
      GUILD_REMOVED: EXTERNAL_STOP_TRANSITIONS,
      CHANNEL_DELETED: EXTERNAL_STOP_TRANSITIONS,
      PRODUCER_FAILED: EXTERNAL_STOP_TRANSITIONS,
    },
    states: {
      idle: {
        entry: "resetPlayback",
        always: { guard: "hasQueue", target: "joining" },
        on: { JOIN: { target: "joining" } },
      },
      joining: {
        invoke: {
          src: "joinVoice",
          input: ({ context }) => ({
            guildId: context.guildId,
            channelId: context.channelId,
          }),
          onDone: {
            target: "advance",
            actions: assign({
              voice: ({ event }) => event.output,
              lastError: null,
              lastErrorKind: null,
            }),
          },
          onError: {
            target: "failed",
            actions: assign({
              lastError: ({ event }) => getErrorMessage(event.error),
              lastErrorKind: "generic",
            }),
          },
        },
        // Bound a stuck voice handshake and abort it on state exit.
        after: {
          joinTimeout: {
            target: "failed",
            actions: assign({
              lastError: "voice join timed out",
              lastErrorKind: "timeout",
            }),
          },
        },
        on: {
          STOP: { target: "idle", actions: "clearQueue" },
          LEAVE: { target: "idle", actions: "clearQueue" },
        },
      },
      // Transient: choose the next item to play according to the loop mode.
      advance: {
        always: [
          {
            guard: "shouldStartPaused",
            target: "paused",
            actions: assign(({ context }) => ({
              current: context.queue[0] ?? null,
              queue: context.queue.slice(1),
              pausedPositionSeconds: context.resumeSeekSeconds,
              resumeSeekSeconds: 0,
              startPaused: false,
            })),
          },
          { guard: "isTrackReplay", target: "resolving" },
          {
            guard: "isQueueLoopHasContent",
            actions: ["requeueCurrent", "dequeue"],
            target: "resolving",
          },
          { guard: "hasQueue", actions: ["dequeue"], target: "resolving" },
          { actions: "clearCurrent", target: "waiting" },
        ],
      },
      // Transient: drop the current item and move on, ignoring loop (used by SKIP and after a failure).
      skipped: {
        always: [
          { guard: "hasQueue", actions: ["dequeue"], target: "resolving" },
          { actions: "clearCurrent", target: "waiting" },
        ],
      },
      resolving: {
        invoke: {
          src: "resolveSource",
          input: ({ context }) => {
            const current = mustCurrent(context);
            return {
              source: current.source,
              ...(current.preResolved === undefined
                ? {}
                : { preResolved: current.preResolved }),
            };
          },
          onDone: {
            target: "streaming",
            actions: assign(({ context, event }) =>
              resolveDoneUpdates(context, event.output),
            ),
          },
          onError: {
            target: "failed",
            actions: [
              assign(({ context, event }) =>
                resolveErrorUpdates(context, event.error),
              ),
              "clearRecovery",
            ],
          },
        },
        // Bound a hung resolver; state exit aborts its subprocess.
        after: {
          resolveTimeout: {
            target: "failed",
            actions: [
              assign({
                lastError: "resolving the source timed out",
                lastErrorKind: "timeout",
              }),
              "clearRecovery",
            ],
          },
        },
        on: {
          PLAY_NOW: { target: "resolving", actions: "playNow" },
          SKIP: { target: "skipped", actions: "clearRecovery" },
          STOP: { target: "leaving", actions: ["clearQueue", "clearRecovery"] },
        },
      },
      streaming: {
        // Consume the one-shot resume seek after invoke input is evaluated.
        exit: "consumeSeek",
        invoke: {
          src: "runStream",
          input: ({ context }) => ({
            voice: mustVoice(context),
            resolved: mustResolved(context),
            volume: context.volume,
            seekSeconds: context.resumeSeekSeconds,
            pipelineMode: pipelineForAttempt(context.crashRetries),
          }),
          onDone: { target: "advance", actions: "resetCrashRetries" },
          onError: [
            // Re-resolve a crashed item at its last position while retry budget remains.
            {
              guard: ({ context, event }) =>
                streamCrashFrom(event.error) !== null &&
                context.crashRetries < MAX_CRASH_RETRIES &&
                context.current !== null,
              target: "skipped",
              actions: assign(({ context, event }) => {
                const crash = streamCrashFrom(event.error);
                return crash === null
                  ? {}
                  : queueCrashRetryUpdates(context, {
                      reason: crash.kind,
                      positionSeconds: crash.positionSeconds,
                    });
              }),
            },
            // Drop an exhausted or non-crash failure, announce, then continue.
            {
              target: "failed",
              actions: assign(({ context, event }) =>
                streamErrorUpdates(context, event.error),
              ),
            },
          ],
        },
        on: {
          PLAY_NOW: { target: "resolving", actions: "playNow" },
          PAUSE: {
            target: "paused",
            actions: assign({
              pausedPositionSeconds: ({ event }) =>
                Math.max(0, event.positionSeconds),
            }),
          },
          RESTART: {
            target: "resolving",
            actions: assign({ resumeSeekSeconds: 0, crashRetries: 0 }),
          },
          SKIP: { target: "skipped", actions: "resetCrashRetries" },
          STOP: {
            target: "leaving",
            actions: ["clearQueue", "resetCrashRetries"],
          },
          // Treat a stalled producer like a bounded crash retry.
          PRODUCER_STALLED: [
            {
              guard: "isCrashRetryable",
              target: "skipped",
              actions: assign(({ context, event }) =>
                queueCrashRetryUpdates(context, {
                  reason: "stall",
                  positionSeconds: event.positionSeconds ?? 0,
                }),
              ),
            },
            {
              target: "failed",
              actions: assign(({ context, event }) =>
                crashGiveUpUpdates(context, {
                  reason: "stall",
                  positionSeconds: event.positionSeconds ?? 0,
                  lastError: `stream stalled: ${event.reason}`,
                }),
              ),
            },
          ],
          // Restart with new subtitles at the current position.
          CHANGE_SUBTITLES: {
            target: "skipped",
            actions: assign(({ context, event }) => {
              const current = mustCurrent(context);
              return {
                queue: [
                  {
                    source: withSubtitles(current.source, event.subtitles),
                    requesterId: current.requesterId,
                    ...(current.requestId === undefined
                      ? {}
                      : { requestId: current.requestId }),
                  },
                  ...context.queue,
                ],
                resumeSeekSeconds: event.positionSeconds,
                crashRetries: 0,
              };
            }),
          },
        },
      },
      paused: {
        on: {
          RESUME: {
            target: "resolving",
            actions: assign(({ context }) => ({
              resumeSeekSeconds: context.pausedPositionSeconds ?? 0,
              pausedPositionSeconds: null,
            })),
          },
          RESTART: {
            target: "resolving",
            actions: assign({
              resumeSeekSeconds: 0,
              pausedPositionSeconds: null,
              crashRetries: 0,
            }),
          },
          PLAY_NOW: { target: "resolving", actions: "playNow" },
          SKIP: {
            target: "skipped",
            actions: assign({ pausedPositionSeconds: null }),
          },
          STOP: {
            target: "leaving",
            actions: ["clearQueue", assign({ pausedPositionSeconds: null })],
          },
          LEAVE: {
            target: "leaving",
            actions: ["clearQueue", assign({ pausedPositionSeconds: null })],
          },
        },
      },
      // In voice, nothing playing: hold for a grace period, then disconnect. New items resume play.
      waiting: {
        after: { idleTimeout: { target: "leaving" } },
        always: { guard: "hasQueue", target: "advance" },
        on: {
          STOP: { target: "leaving", actions: "clearQueue" },
          LEAVE: { target: "leaving", actions: "clearQueue" },
        },
      },
      leaving: {
        invoke: {
          src: "leaveVoice",
          input: ({ context }) => ({ voice: mustVoice(context) }),
          onDone: { target: "idle" },
          onError: {
            target: "idle",
            actions: assign({
              lastError: ({ event }) => getErrorMessage(event.error),
              lastErrorKind: "generic",
            }),
          },
        },
        // Bound a hung leave.
        after: {
          leaveTimeout: {
            target: "idle",
            actions: assign({
              lastError: "leaving voice timed out",
              lastErrorKind: "timeout",
            }),
          },
        },
      },
      // Transient: with a live voice connection, drop the bad item and continue; otherwise bail.
      failed: {
        always: [
          { guard: "hasVoice", target: "skipped" },
          { target: "idle", actions: "clearQueue" },
        ],
      },
    },
  });
}
