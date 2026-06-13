import { assign, fromPromise, setup } from "xstate";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
import { BlockedSourceError } from "@shepherdjerred/streambot/moderation/adult-block.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";
import {
  moveItem,
  removeAt,
  shuffleQueue,
} from "@shepherdjerred/streambot/machine/queue-ops.ts";
import type {
  JoinVoiceInput,
  LeaveVoiceInput,
  PlaybackContext,
  PlaybackEvent,
  PlaybackInput,
  ResolvedSource,
  ResolveSourceInput,
  RunStreamInput,
  VoiceHandle,
} from "@shepherdjerred/streambot/machine/types.ts";

// Branded placeholders for the XState `types` phantom (never read at runtime).
const PLACEHOLDER_GUILD = GuildIdSchema.parse("000000000000000000");
const PLACEHOLDER_CHANNEL = ChannelIdSchema.parse("000000000000000000");

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
  /** Resolves when the stream ends naturally; rejects on stream error. */
  runStream: (input: RunStreamInput, signal: AbortSignal) => Promise<void>;
  leaveVoice: (input: LeaveVoiceInput, signal: AbortSignal) => Promise<void>;
};

const VOLUME_MIN = 0;
const VOLUME_MAX = 200;
const EXTERNAL_STOP_MESSAGES: ReadonlyMap<PlaybackEvent["type"], string> =
  new Map([
    ["GUILD_REMOVED", "guild removed"],
    ["CHANNEL_DELETED", "voice channel deleted"],
    ["SHUTDOWN", "shutdown"],
  ]);

function mustCurrent(
  context: PlaybackContext,
): NonNullable<PlaybackContext["current"]> {
  if (context.current === null) {
    throw new Error("invariant: no current source while resolving");
  }
  return context.current;
}

function mustVoice(context: PlaybackContext): VoiceHandle {
  if (context.voice === null) {
    throw new Error("invariant: no voice connection");
  }
  return context.voice;
}

function mustResolved(context: PlaybackContext): ResolvedSource {
  if (context.resolved === null) {
    throw new Error("invariant: no resolved source while streaming");
  }
  return context.resolved;
}

function externalStopMessage(event: PlaybackEvent): string {
  if (event.type === "STREAMER_VOICE_DETACHED") {
    return event.reason ?? "streamer voice detached";
  }
  if (event.type === "PRODUCER_FAILED") {
    return event.reason;
  }
  return EXTERNAL_STOP_MESSAGES.get(event.type) ?? "external stream event";
}

/**
 * Build the playback state machine — the single source of truth for the streaming lifecycle. All
 * I/O is delegated to the provided {@link PlaybackActors}, so the machine is pure and every
 * transition (queue edits, loop modes, skip/stop, blocked sources, idle disconnect) is
 * deterministically unit-testable.
 *
 * Flow: `idle → joining → advance → resolving → streaming → advance → … → waiting → leaving → idle`.
 * `advance` picks the next item per loop mode; `waiting` holds the voice connection for a grace
 * period before disconnecting; `failed` drops a bad/blocked item and continues (or bails on join
 * failure).
 */
export function createPlaybackMachine(actors: PlaybackActors) {
  const machineTypes: {
    context: PlaybackContext;
    events: PlaybackEvent;
    input: PlaybackInput;
  } = {
    context: {
      guildId: PLACEHOLDER_GUILD,
      channelId: PLACEHOLDER_CHANNEL,
      idleTimeoutMs: 0,
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
    },
    events: { type: "SKIP" },
    input: {
      guildId: PLACEHOLDER_GUILD,
      channelId: PLACEHOLDER_CHANNEL,
      idleTimeoutMs: 0,
    },
  };

  return setup({
    types: machineTypes,
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
    },
    guards: {
      hasQueue: ({ context }) => context.queue.length > 0,
      hasVoice: ({ context }) => context.voice !== null,
      isTrackReplay: ({ context }) =>
        context.loop === "track" && context.current !== null,
      isQueueLoopHasContent: ({ context }) =>
        context.loop === "queue" &&
        (context.current !== null || context.queue.length > 0),
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
      moveVoiceTarget: assign({
        guildId: ({ event, context }) =>
          event.type === "VOICE_TARGET_MOVED"
            ? GuildIdSchema.parse(event.target.guildId)
            : context.guildId,
        channelId: ({ event, context }) =>
          event.type === "VOICE_TARGET_MOVED"
            ? ChannelIdSchema.parse(event.target.channelId)
            : context.channelId,
        voice: ({ event, context }) => {
          if (event.type !== "VOICE_TARGET_MOVED") {
            return context.voice;
          }
          if (context.voice === null) {
            return null;
          }
          return {
            guildId: GuildIdSchema.parse(event.target.guildId),
            channelId: ChannelIdSchema.parse(event.target.channelId),
          };
        },
      }),
      // Consume the one-shot resume seek so only the first post-restart playthrough seeks; any
      // loop/replay of the same item starts from 0.
      consumeSeek: assign({ resumeSeekSeconds: 0 }),
    },
  }).createMachine({
    id: "playback",
    context: ({ input }) => ({
      guildId: input.guildId,
      channelId: input.channelId,
      idleTimeoutMs: input.idleTimeoutMs,
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
    }),
    initial: "idle",
    // Queue-editing events are accepted in every state (they only touch context).
    on: {
      ADD: {
        actions: assign({
          queue: ({ context, event }) => [
            ...context.queue,
            { source: event.source, requesterId: event.requesterId },
          ],
        }),
      },
      ADD_NEXT: {
        actions: assign({
          queue: ({ context, event }) => [
            { source: event.source, requesterId: event.requesterId },
            ...context.queue,
          ],
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
      STREAMER_VOICE_DETACHED: [
        {
          guard: "hasVoice",
          target: "#playback.leaving",
          actions: ["clearQueue", "recordExternalStop"],
        },
        {
          target: "#playback.idle",
          actions: ["clearQueue", "recordExternalStop"],
        },
      ],
      GUILD_REMOVED: [
        {
          guard: "hasVoice",
          target: "#playback.leaving",
          actions: ["clearQueue", "recordExternalStop"],
        },
        {
          target: "#playback.idle",
          actions: ["clearQueue", "recordExternalStop"],
        },
      ],
      CHANNEL_DELETED: [
        {
          guard: "hasVoice",
          target: "#playback.leaving",
          actions: ["clearQueue", "recordExternalStop"],
        },
        {
          target: "#playback.idle",
          actions: ["clearQueue", "recordExternalStop"],
        },
      ],
      PRODUCER_FAILED: [
        {
          guard: "hasVoice",
          target: "#playback.leaving",
          actions: ["clearQueue", "recordExternalStop"],
        },
        {
          target: "#playback.idle",
          actions: ["clearQueue", "recordExternalStop"],
        },
      ],
      SHUTDOWN: [
        {
          guard: "hasVoice",
          target: "#playback.leaving",
          actions: ["clearQueue", "recordExternalStop"],
        },
        {
          target: "#playback.idle",
          actions: ["clearQueue", "recordExternalStop"],
        },
      ],
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
          input: ({ context }) => ({ source: mustCurrent(context).source }),
          onDone: {
            target: "streaming",
            actions: assign({
              resolved: ({ event }) => event.output,
              lastError: null,
              lastErrorKind: null,
            }),
          },
          onError: {
            target: "failed",
            actions: assign(({ context, event }) => {
              const blocked = event.error instanceof BlockedSourceError;
              return {
                lastError: getErrorMessage(event.error),
                lastErrorKind: blocked ? "blocked" : "generic",
                blockedNonce: blocked
                  ? context.blockedNonce + 1
                  : context.blockedNonce,
                lastBlockedRequester: blocked
                  ? (context.current?.requesterId ?? null)
                  : context.lastBlockedRequester,
              };
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
          }),
          onDone: { target: "advance" },
          onError: {
            target: "failed",
            actions: assign({
              lastError: ({ event }) => getErrorMessage(event.error),
              lastErrorKind: "generic",
            }),
          },
        },
        on: {
          SKIP: { target: "skipped" },
          STOP: { target: "leaving", actions: "clearQueue" },
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
