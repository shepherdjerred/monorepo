import { assign, fromPromise, setup } from "xstate";
import type {
  EncoderHandles,
  RawGoLiveContext,
  RawGoLiveDeps,
  RawGoLiveEvent,
  RawGoLiveInput,
  StreamTeardownReason,
} from "./types.ts";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function eventTeardownReason(event: RawGoLiveEvent): StreamTeardownReason {
  switch (event.type) {
    case "STREAMER_VOICE_DETACHED":
      return "voiceDetached";
    case "GUILD_REMOVED":
      return "guildRemoved";
    case "CHANNEL_DELETED":
      return "channelDeleted";
    case "PRODUCER_FAILED":
      return "producerFailed";
    case "SHUTDOWN":
      return "shutdown";
    case "STOP":
      return "userStop";
    case "START":
    case "VOICE_TARGET_MOVED":
      return "undesired";
  }
}

function terminalError(event: RawGoLiveEvent): string | null {
  if (event.type === "PRODUCER_FAILED") {
    return event.reason;
  }
  if (event.type === "STREAMER_VOICE_DETACHED") {
    return event.reason ?? "streamer voice detached";
  }
  return null;
}

export function createRawGoLiveMachine(deps: RawGoLiveDeps) {
  const machineTypes: {
    context: RawGoLiveContext;
    events: RawGoLiveEvent;
    input: RawGoLiveInput;
  } = {
    context: {
      voiceTarget: { guildId: "", channelId: "" },
      frameSink: null,
      encoder: null,
      retries: 0,
      maxRetries: 0,
      lastError: null,
      teardownReason: null,
    },
    events: { type: "START" },
    input: { voiceTarget: { guildId: "", channelId: "" } },
  };

  return setup({
    types: machineTypes,
    actors: {
      joinVoice: fromPromise(
        ({
          input,
          signal,
        }: {
          input: { readonly target: RawGoLiveContext["voiceTarget"] };
          signal: AbortSignal;
        }) => deps.joinVoice(input, signal),
      ),
      prepareEncoder: fromPromise(() => deps.prepareEncoder()),
      runStream: fromPromise(
        ({
          input,
          signal,
        }: {
          input: {
            readonly output: EncoderHandles["output"];
            readonly playing: EncoderHandles["playing"];
          };
          signal: AbortSignal;
        }) => deps.runStream(input, signal),
      ),
      leaveVoice: fromPromise(
        ({ input }: { input: { readonly playing: Promise<void> | null } }) =>
          deps.leaveVoice(input.playing),
      ),
    },
    guards: {
      canRetry: ({ context }) => context.retries < context.maxRetries,
      hasError: ({ context }) => context.lastError !== null,
      isTerminalTeardown: ({ context }) =>
        context.teardownReason === "voiceDetached" ||
        context.teardownReason === "guildRemoved" ||
        context.teardownReason === "channelDeleted" ||
        context.teardownReason === "producerFailed" ||
        context.teardownReason === "shutdown",
    },
    delays: {
      retryDelay: deps.retryDelayMs ?? 2000,
    },
    actions: {
      clearRuntimeHandles: assign({
        frameSink: null,
        encoder: null,
      }),
      clearHealthyState: assign({
        retries: 0,
        lastError: null,
        teardownReason: null,
      }),
      markTerminalTeardown: assign({
        lastError: ({ event }) => terminalError(event),
        teardownReason: ({ event }) => eventTeardownReason(event),
      }),
      markUserStop: assign({
        lastError: null,
        teardownReason: "userStop",
      }),
      moveVoiceTarget: assign({
        voiceTarget: ({ event, context }) =>
          event.type === "VOICE_TARGET_MOVED"
            ? event.target
            : context.voiceTarget,
        lastError: null,
        teardownReason: "undesired",
      }),
      reportFailure: ({ context }) => {
        deps.onFailure?.({
          attempt: context.retries + 1,
          maxRetries: context.maxRetries,
          error: context.lastError,
        });
      },
    },
  }).createMachine({
    id: "rawGoLive",
    initial: "idle",
    context: ({ input }) => ({
      voiceTarget: input.voiceTarget,
      frameSink: null,
      encoder: null,
      retries: 0,
      maxRetries: input.maxRetries ?? 3,
      lastError: null,
      teardownReason: null,
    }),
    states: {
      idle: {
        entry: ["clearRuntimeHandles", "clearHealthyState"],
        on: {
          START: "joining",
          VOICE_TARGET_MOVED: { actions: "moveVoiceTarget" },
          STREAMER_VOICE_DETACHED: {
            target: "terminated",
            actions: "markTerminalTeardown",
          },
          GUILD_REMOVED: {
            target: "terminated",
            actions: "markTerminalTeardown",
          },
          CHANNEL_DELETED: {
            target: "terminated",
            actions: "markTerminalTeardown",
          },
          PRODUCER_FAILED: {
            target: "terminated",
            actions: "markTerminalTeardown",
          },
          SHUTDOWN: {
            target: "terminated",
            actions: "markTerminalTeardown",
          },
        },
      },
      joining: {
        invoke: {
          src: "joinVoice",
          input: ({ context }) => ({ target: context.voiceTarget }),
          onDone: "preparing",
          onError: {
            target: "failed",
            actions: assign({
              lastError: ({ event }) => errorMessage(event.error),
              teardownReason: null,
            }),
          },
        },
        on: {
          STOP: { target: "stopping", actions: "markUserStop" },
          VOICE_TARGET_MOVED: {
            target: "stopping",
            actions: "moveVoiceTarget",
          },
          STREAMER_VOICE_DETACHED: {
            target: "stopping",
            actions: "markTerminalTeardown",
          },
          GUILD_REMOVED: {
            target: "stopping",
            actions: "markTerminalTeardown",
          },
          CHANNEL_DELETED: {
            target: "stopping",
            actions: "markTerminalTeardown",
          },
          PRODUCER_FAILED: {
            target: "stopping",
            actions: "markTerminalTeardown",
          },
          SHUTDOWN: { target: "stopping", actions: "markTerminalTeardown" },
        },
      },
      preparing: {
        invoke: {
          src: "prepareEncoder",
          onDone: {
            target: "streaming",
            actions: assign({
              encoder: ({ event }) => event.output,
              frameSink: ({ event }) => event.output.sink,
              teardownReason: null,
            }),
          },
          onError: {
            target: "stopping",
            actions: assign({
              lastError: ({ event }) => errorMessage(event.error),
            }),
          },
        },
        on: {
          STOP: { target: "stopping", actions: "markUserStop" },
          VOICE_TARGET_MOVED: {
            target: "stopping",
            actions: "moveVoiceTarget",
          },
          STREAMER_VOICE_DETACHED: {
            target: "stopping",
            actions: "markTerminalTeardown",
          },
          GUILD_REMOVED: {
            target: "stopping",
            actions: "markTerminalTeardown",
          },
          CHANNEL_DELETED: {
            target: "stopping",
            actions: "markTerminalTeardown",
          },
          PRODUCER_FAILED: {
            target: "stopping",
            actions: "markTerminalTeardown",
          },
          SHUTDOWN: { target: "stopping", actions: "markTerminalTeardown" },
        },
      },
      streaming: {
        entry: assign({ retries: 0, lastError: null, teardownReason: null }),
        invoke: {
          src: "runStream",
          input: ({ context }) => {
            const encoder = context.encoder;
            if (encoder === null) {
              throw new Error("invariant: encoder missing in streaming state");
            }
            return { output: encoder.output, playing: encoder.playing };
          },
          onDone: {
            target: "stopping",
            actions: assign({
              lastError: "stream ended unexpectedly",
            }),
          },
          onError: {
            target: "stopping",
            actions: assign({
              lastError: ({ event }) => errorMessage(event.error),
            }),
          },
        },
        on: {
          STOP: { target: "stopping", actions: "markUserStop" },
          VOICE_TARGET_MOVED: {
            target: "stopping",
            actions: "moveVoiceTarget",
          },
          STREAMER_VOICE_DETACHED: {
            target: "stopping",
            actions: "markTerminalTeardown",
          },
          GUILD_REMOVED: {
            target: "stopping",
            actions: "markTerminalTeardown",
          },
          CHANNEL_DELETED: {
            target: "stopping",
            actions: "markTerminalTeardown",
          },
          PRODUCER_FAILED: {
            target: "stopping",
            actions: "markTerminalTeardown",
          },
          SHUTDOWN: { target: "stopping", actions: "markTerminalTeardown" },
        },
      },
      stopping: {
        entry: [
          ({ context }) => {
            context.frameSink?.end();
          },
          assign({ frameSink: null }),
        ],
        invoke: {
          src: "leaveVoice",
          input: ({ context }) => ({
            playing: context.encoder?.playing ?? null,
          }),
          onDone: [
            { guard: "isTerminalTeardown", target: "terminated" },
            { guard: "hasError", target: "failed" },
            { target: "idle" },
          ],
          onError: [
            { guard: "isTerminalTeardown", target: "terminated" },
            { guard: "hasError", target: "failed" },
            { target: "idle" },
          ],
        },
        exit: assign({ encoder: null }),
      },
      failed: {
        entry: [
          "reportFailure",
          assign({ retries: ({ context }) => context.retries + 1 }),
        ],
        on: {
          START: "joining",
          STOP: "idle",
          VOICE_TARGET_MOVED: { target: "idle", actions: "moveVoiceTarget" },
          STREAMER_VOICE_DETACHED: {
            target: "terminated",
            actions: "markTerminalTeardown",
          },
          GUILD_REMOVED: {
            target: "terminated",
            actions: "markTerminalTeardown",
          },
          CHANNEL_DELETED: {
            target: "terminated",
            actions: "markTerminalTeardown",
          },
          PRODUCER_FAILED: {
            target: "terminated",
            actions: "markTerminalTeardown",
          },
          SHUTDOWN: {
            target: "terminated",
            actions: "markTerminalTeardown",
          },
        },
        after: {
          retryDelay: [
            { guard: "canRetry", target: "joining" },
            { target: "idle" },
          ],
        },
      },
      terminated: {
        type: "final",
        entry: "clearRuntimeHandles",
      },
    },
  });
}
