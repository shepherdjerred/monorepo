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
  externalStopMessage,
  JOIN_TIMEOUT_MS,
  LEAVE_TIMEOUT_MS,
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
  RESOLVE_TIMEOUT_MS,
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
export function createPlaybackMachine(actors: PlaybackActors) {
  // Shared by every externally-driven stop (guild/channel gone, producer dead, shutdown).
  const externalStopTransitions = [
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
      resetPlayback: assign({ current: null, resolved: null, voice: null }),
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
    },
  }).createMachine({
    id: "playback",
    context: ({ input }) => ({
      guildId: input.guildId,
      channelId: input.channelId,
      idleTimeoutMs: input.idleTimeoutMs,
      wedgeTimeoutsMs: {
        join: input.wedgeTimeoutsMs?.join ?? JOIN_TIMEOUT_MS,
        resolve: input.wedgeTimeoutsMs?.resolve ?? RESOLVE_TIMEOUT_MS,
        leave: input.wedgeTimeoutsMs?.leave ?? LEAVE_TIMEOUT_MS,
      },
      // Resume seeding: the in-progress item (if any) is placed at queue[0] by the caller, so the
      // normal idle → joining → advance(dequeue) → resolving → streaming flow plays it first.
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
    }),
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
      STREAMER_VOICE_DETACHED: externalStopTransitions,
      GUILD_REMOVED: externalStopTransitions,
      CHANNEL_DELETED: externalStopTransitions,
      PRODUCER_FAILED: externalStopTransitions,
      SHUTDOWN: externalStopTransitions,
    },
    states: {
      idle: {
        entry: "resetPlayback",
        always: { guard: "hasQueue", target: "joining" },
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
        // The fork's joinVoice promise only ever resolves (no rejection path for a stuck voice
        // handshake) — without this the machine would wedge here forever. Leaving the state
        // aborts the pending join via the actor's signal.
        after: {
          joinTimeout: {
            target: "failed",
            actions: assign({
              lastError: "voice join timed out",
              lastErrorKind: "timeout",
            }),
          },
        },
        on: { STOP: { target: "idle", actions: "clearQueue" } },
      },
      // Transient: choose the next item to play according to the loop mode.
      advance: {
        always: [
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
            actions: assign(({ context, event }) =>
              resolveErrorUpdates(context, event.error),
            ),
          },
        },
        // Wedge guard: the yt-dlp resolve path has no timeout of its own — a hung probe would
        // hold this state forever. Leaving the state aborts the subprocess via the actor signal;
        // `failed` then drops the item and the queue continues.
        after: {
          resolveTimeout: {
            target: "failed",
            actions: assign({
              lastError: "resolving the source timed out",
              lastErrorKind: "timeout",
            }),
          },
        },
        on: {
          SKIP: { target: "skipped" },
          STOP: { target: "leaving", actions: "clearQueue" },
        },
      },
      streaming: {
        // Zero the one-shot resume seek once the segment is underway, so loop/replay restarts at 0.
        // Exit runs after `invoke.input` is evaluated, so the first playthrough still gets the seek.
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
            // Mid-stream death (crash or exit-0 truncation) with retry budget left: re-queue the
            // current item at its head and replay from the crash position. Going back through
            // `resolving` re-resolves the source — which also regenerates expired network URLs.
            // Exit-order note: the state's `consumeSeek` exit action runs BEFORE these transition
            // actions in XState v5, so the resumeSeekSeconds written here survives.
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
            // Retry budget spent on a crashing item, or a non-crash stream error: drop it (via
            // `failed` → `skipped`), announce, and continue with the rest of the queue.
            {
              target: "failed",
              actions: assign(({ context, event }) =>
                streamErrorUpdates(context, event.error),
              ),
            },
          ],
        },
        on: {
          SKIP: { target: "skipped", actions: "resetCrashRetries" },
          STOP: {
            target: "leaving",
            actions: ["clearQueue", "resetCrashRetries"],
          },
          // The stall watchdog (stream-observer → session-manager) saw ffmpeg stop producing while
          // the process stayed alive — the machine would otherwise sit here forever. Same bounded
          // recovery ladder as a crash; leaving the state aborts the wedged ffmpeg.
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
          // Restart the current source with a new subtitle preference at the same position —
          // reuses the resume-seek plumbing (`resumeSeekSeconds`) that voice-reconnect resume
          // already relies on, so no new state is needed beyond the existing `skipped` transient.
          CHANGE_SUBTITLES: {
            target: "skipped",
            actions: assign(({ context, event }) => {
              const current = mustCurrent(context);
              return {
                queue: [
                  {
                    source: withSubtitles(current.source, event.subtitles),
                    requesterId: current.requesterId,
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
      // In voice, nothing playing: hold for a grace period, then disconnect. New items resume play.
      waiting: {
        after: { idleTimeout: { target: "leaving" } },
        always: { guard: "hasQueue", target: "advance" },
        on: { STOP: { target: "leaving", actions: "clearQueue" } },
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
        // Wedge guard: a hung leave must not hold the session open forever.
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
