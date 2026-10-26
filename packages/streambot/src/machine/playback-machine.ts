import type { PlaybackActors } from "./playback-actors.ts";
import { playbackSetup } from "./playback-setup.ts";
import { assign } from "xstate";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import {
  insertBatch,
  replaceQueued,
  moveItem,
  removeAt,
  shuffleQueue,
} from "./queue-ops.ts";
import { withSubtitles } from "@shepherdjerred/streambot/sources/source.ts";
import {
  crashGiveUpUpdates,
  EXTERNAL_STOP_TRANSITIONS,
  initialPlaybackContext,
  MAX_CRASH_RETRIES,
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
} from "./playback-helpers.ts";
const VOLUME_MIN = 0;
const VOLUME_MAX = 200;

export function createPlaybackMachine(actors: PlaybackActors) {
  return playbackSetup(actors).createMachine({
    id: "playback",
    context: ({ input }) => initialPlaybackContext(input),
    initial: "idle",
    on: {
      REPLACE_QUEUED: {
        actions: assign({
          queue: ({ context, event }) =>
            replaceQueued(context.queue, event.index, event.source),
        }),
      },
      ADD_BATCH: {
        actions: assign({
          queue: ({ context, event }) =>
            insertBatch(context.queue, event.items, event.placement),
        }),
      },
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
          PLAY_NOW: { actions: "playNowWhileJoining" },
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
          LEAVE: {
            target: "leaving",
            actions: ["clearQueue", "clearRecovery"],
          },
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
          onDone: { target: "advance", actions: "completeStream" },
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
          LEAVE: {
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
              const { preResolved: _resolved, ...queued } = current;
              return {
                queue: [
                  {
                    ...queued,
                    source: withSubtitles(current.source, event.subtitles),
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
