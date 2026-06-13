import { assign, enqueueActions, sendTo, setup } from "xstate";
import { createRawGoLiveMachine } from "./raw-go-live-machine.ts";
import type {
  DesiredStreamContext,
  DesiredStreamEvent,
  DesiredStreamInput,
  RawGoLiveDeps,
} from "./types.ts";

export function createDesiredStreamMachine(deps: RawGoLiveDeps) {
  const rawGoLiveMachine = createRawGoLiveMachine(deps);
  const machineTypes: {
    context: DesiredStreamContext;
    events: DesiredStreamEvent;
    input: DesiredStreamInput;
  } = {
    context: {
      desired: false,
      voiceTarget: { guildId: "", channelId: "" },
      frameSink: null,
      maxRetries: 0,
      teardownReason: null,
    },
    events: { type: "SET_DESIRED", desired: false },
    input: { voiceTarget: { guildId: "", channelId: "" } },
  };

  return setup({
    types: machineTypes,
    actors: { rawGoLive: rawGoLiveMachine },
  }).createMachine({
    id: "desiredStream",
    context: ({ input }) => ({
      desired: false,
      voiceTarget: input.voiceTarget,
      frameSink: null,
      maxRetries: input.maxRetries ?? 3,
      teardownReason: null,
    }),
    invoke: {
      src: "rawGoLive",
      id: "rawGoLive",
      input: ({ context }) => ({
        voiceTarget: context.voiceTarget,
        maxRetries: context.maxRetries,
      }),
      onSnapshot: {
        actions: enqueueActions(({ context, event, enqueue }) => {
          const child = event.snapshot;
          enqueue.assign({
            frameSink: child.context.frameSink,
            teardownReason: child.context.teardownReason,
          });
          if (child.matches("idle") && context.desired) {
            enqueue.sendTo("rawGoLive", { type: "START" });
          } else if (child.matches("streaming") && !context.desired) {
            enqueue.sendTo("rawGoLive", { type: "STOP" });
          } else if (child.matches("terminated") && context.desired) {
            enqueue.assign({ desired: false });
          }
        }),
      },
    },
    on: {
      SET_DESIRED: {
        actions: [
          assign({ desired: ({ event }) => event.desired }),
          sendTo("rawGoLive", ({ event }) => ({
            type: event.desired ? "START" : "STOP",
          })),
        ],
      },
      VOICE_TARGET_MOVED: {
        actions: [
          assign({ voiceTarget: ({ event }) => event.target }),
          sendTo("rawGoLive", ({ event }) => event),
        ],
      },
      STREAMER_VOICE_DETACHED: {
        actions: [
          assign({ desired: false }),
          sendTo("rawGoLive", ({ event }) => event),
        ],
      },
      GUILD_REMOVED: {
        actions: [
          assign({ desired: false }),
          sendTo("rawGoLive", ({ event }) => event),
        ],
      },
      CHANNEL_DELETED: {
        actions: [
          assign({ desired: false }),
          sendTo("rawGoLive", ({ event }) => event),
        ],
      },
      PRODUCER_FAILED: {
        actions: [
          assign({ desired: false }),
          sendTo("rawGoLive", ({ event }) => event),
        ],
      },
      SHUTDOWN: {
        actions: [
          assign({ desired: false }),
          sendTo("rawGoLive", ({ event }) => event),
        ],
      },
    },
  });
}
