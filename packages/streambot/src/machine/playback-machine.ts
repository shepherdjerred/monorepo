import { assign, fromPromise, setup } from "xstate";
import { getErrorMessage } from "@shepherdjerred/streambot/util/errors.ts";
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

/**
 * The side-effecting operations the machine drives. Implementations live in the streamer/sources
 * layers (real) or are stubbed in tests. Each receives an {@link AbortSignal} that fires when the
 * machine leaves the invoking state (e.g. SKIP/STOP) so I/O can cancel promptly.
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

/**
 * Build the playback state machine. The machine is the single source of truth for the streaming
 * lifecycle; all I/O is delegated to the provided {@link PlaybackActors}. Keeping the machine pure
 * makes every transition deterministically unit-testable.
 *
 * Lifecycle: `idle → joining → resolving → streaming → (advance) → resolving|leaving → idle`,
 * with `failed` handling join/resolve/stream errors (drop the bad item and continue, or bail).
 */
export function createPlaybackMachine(actors: PlaybackActors) {
  // XState's `setup({ types })` reads the *type* of these phantom values for inference; the values
  // are never used at runtime. An explicitly-annotated holder locks the full types — in particular
  // the event union — so we get sound inference without an `as` assertion. (The values are valid
  // members of each type; the annotation, not the literals, drives inference.)
  const machineTypes: {
    context: PlaybackContext;
    events: PlaybackEvent;
    input: PlaybackInput;
  } = {
    context: {
      guildId: "",
      channelId: "",
      queue: [],
      current: null,
      voice: null,
      resolved: null,
      lastError: null,
    },
    events: { type: "SKIP" },
    input: { guildId: "", channelId: "" },
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
    guards: {
      hasQueue: ({ context }) => context.queue.length > 0,
      hasVoice: ({ context }) => context.voice !== null,
    },
    actions: {
      dequeue: assign({
        current: ({ context }) => context.queue[0] ?? null,
        queue: ({ context }) => context.queue.slice(1),
      }),
      clearQueue: assign({ queue: [] }),
      resetPlayback: assign({ current: null, resolved: null, voice: null }),
    },
  }).createMachine({
    id: "playback",
    context: ({ input }) => ({
      guildId: input.guildId,
      channelId: input.channelId,
      queue: [],
      current: null,
      voice: null,
      resolved: null,
      lastError: null,
    }),
    initial: "idle",
    // ADD is accepted in every state: it always just enqueues. `idle` then auto-starts via its
    // `always` guard, so an ADD that arrives mid-shutdown still plays once we settle back to idle.
    on: {
      ADD: {
        actions: assign({
          queue: ({ context, event }) => [
            ...context.queue,
            { source: event.source, requesterId: event.requesterId },
          ],
        }),
      },
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
            target: "resolving",
            actions: assign({
              voice: ({ event }) => event.output,
              lastError: null,
            }),
          },
          onError: {
            target: "failed",
            actions: assign({
              lastError: ({ event }) => getErrorMessage(event.error),
            }),
          },
        },
        on: {
          STOP: { target: "idle", actions: "clearQueue" },
        },
      },
      resolving: {
        entry: "dequeue",
        invoke: {
          src: "resolveSource",
          input: ({ context }) => ({ source: mustCurrent(context).source }),
          onDone: {
            target: "streaming",
            actions: assign({
              resolved: ({ event }) => event.output,
              lastError: null,
            }),
          },
          onError: {
            target: "failed",
            actions: assign({
              lastError: ({ event }) => getErrorMessage(event.error),
            }),
          },
        },
        on: {
          SKIP: { target: "advance" },
          STOP: { target: "leaving", actions: "clearQueue" },
        },
      },
      streaming: {
        invoke: {
          src: "runStream",
          input: ({ context }) => ({
            voice: mustVoice(context),
            resolved: mustResolved(context),
          }),
          onDone: { target: "advance" },
          onError: {
            target: "failed",
            actions: assign({
              lastError: ({ event }) => getErrorMessage(event.error),
            }),
          },
        },
        on: {
          SKIP: { target: "advance" },
          STOP: { target: "leaving", actions: "clearQueue" },
        },
      },
      // Transient: pick the next item or wind down.
      advance: {
        always: [
          { guard: "hasQueue", target: "resolving" },
          { target: "leaving" },
        ],
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
            }),
          },
        },
      },
      // Transient: with a live voice connection, drop the failed item and continue; otherwise
      // (e.g. join failed) clear the queue and rest, so we never hot-loop a persistent failure.
      failed: {
        always: [
          { guard: "hasVoice", target: "advance" },
          { target: "idle", actions: "clearQueue" },
        ],
      },
    },
  });
}
