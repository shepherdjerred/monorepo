import { trace } from "@opentelemetry/api";
import {
  createLlmRuntime,
  type DecisionChoiceOption,
  type LlmRuntime,
  type LlmRuntimeLogger,
  type LlmRuntimeOptions,
} from "@shepherdjerred/llm-runtime";
import type {
  RealtimeVerifiedCommandRouteInput,
  RealtimeVerifiedCommandRouteResult,
  RealtimeVerifiedCommandRouter,
} from "@shepherdjerred/voice-assistant";
import type { Registry } from "prom-client";
import { z } from "zod";
import { register } from "@shepherdjerred/streambot/observability/metrics-registry.ts";
import {
  VOICE_DECISIONS_CONFIDENCE_THRESHOLD,
  VOICE_DECISIONS_MODEL,
  VOICE_DECISIONS_PROMPT_CACHE_KEY,
  VOICE_DECISIONS_WORKLOAD,
} from "@shepherdjerred/streambot/voice/constants.ts";
import type { ToolName } from "@shepherdjerred/streambot/voice/voice-tool-types.ts";
import {
  invokeStreambotVoiceTool,
  type VoiceCommandPort,
} from "@shepherdjerred/streambot/voice/voice-tools.ts";

export type VoiceDecisionsRuntimeFetch = NonNullable<
  LlmRuntimeOptions["fetch"]
>;

export const STATIC_VOICE_ROUTER_SYSTEM_PROMPT = `You classify wake-verified Streambot Discord voice commands before Realtime speech synthesis.
The leading "Hey Streambot" wake phrase has already been stripped from the input text.

Choose a closed playback intent ONLY when the utterance is a single, unambiguous parameterless or fixed-enum control with no open arguments:
- pause, resume, skip, previous, restart, stop, clear, shuffle, subtitles_off
- loop_off, loop_track, loop_queue
- channel_1, channel_2, channel_auto (only when those choices are listed)

Choose non_command ONLY when the utterance is an accidental wake trigger, empty filler, self-cancellation ("never mind", "cancel that", "ignore me"), or background conversation clearly not asking Streambot to act or answer.

Choose delegate_realtime for EVERYTHING else, including:
- playing or searching any song, video, movie, show, artist, character cover, or sports match
- numbered selections or references ("play 2", "first", "second", "that song again")
- volume changes ("volume 40", "turn it up", "mute")
- time or chapter seeks ("seek to 10 minutes", "go back 30 seconds", "next chapter", "chapter 3")
- queue edits by position ("remove 2", "move 3 to 1")
- turning subtitles on or selecting a subtitle language ("English subtitles", "auto subtitles")
- read-only or spoken status questions ("what's playing?", "what's in the queue?", "list chapters", "what sports are on?", "what channel am I on?")
- channel numbers above 2 ("channel 3")
- compound requests asking for more than one action ("skip and shuffle")`;

const VOICE_ROUTER_QUESTION_INSTRUCTIONS =
  "Classify this wake-stripped Streambot voice utterance into one closed command intent, non_command, or delegate_realtime.";

const BASE_INTENT_CHOICES: readonly DecisionChoiceOption[] = [
  {
    value: "pause",
    description:
      "Pause current playback immediately (e.g. 'pause', 'pause the video', 'hold on').",
  },
  {
    value: "resume",
    description:
      "Resume or unpause paused playback (e.g. 'resume', 'unpause', 'continue playing').",
  },
  {
    value: "skip",
    description:
      "Skip the current item to play the next queued item (e.g. 'skip', 'next', 'next track', 'skip this').",
  },
  {
    value: "previous",
    description:
      "Play the previous item from server history again (e.g. 'previous', 'previous track', 'play the previous song'). Relative time seeks like 'go back 30 seconds' must use delegate_realtime.",
  },
  {
    value: "restart",
    description:
      "Restart the currently playing item from the beginning (e.g. 'restart', 'start over', 'from the beginning').",
  },
  {
    value: "stop",
    description:
      "Stop playback completely and clear the queue (e.g. 'stop', 'stop playback', 'stop playing').",
  },
  {
    value: "clear",
    description:
      "Clear all queued items without stopping the current item (e.g. 'clear queue', 'clear the queue', 'empty queue').",
  },
  {
    value: "shuffle",
    description:
      "Shuffle the queued items (e.g. 'shuffle', 'shuffle the queue').",
  },
  {
    value: "subtitles_off",
    description:
      "Turn subtitles or captions off for the current video (e.g. 'turn off subtitles', 'subtitles off', 'disable captions'). Enabling subtitles or selecting a language must use delegate_realtime.",
  },
  {
    value: "loop_off",
    description:
      "Turn looping off (e.g. 'loop off', 'turn looping off', 'stop looping').",
  },
  {
    value: "loop_track",
    description:
      "Loop the current single track or video (e.g. 'loop this track', 'loop song', 'repeat one').",
  },
  {
    value: "loop_queue",
    description:
      "Loop the full playback queue (e.g. 'loop the queue', 'loop all', 'repeat queue').",
  },
];

const NUMBERED_CHANNEL_CHOICES: readonly DecisionChoiceOption[] = [
  {
    value: "channel_1",
    description:
      "Select Streambot playback channel 1 (mic audio) without starting media (e.g. 'channel 1', 'switch to channel one').",
  },
  {
    value: "channel_2",
    description:
      "Select Streambot playback channel 2 (Go Live video) without starting media (e.g. 'channel 2', 'switch to channel two').",
  },
  {
    value: "channel_auto",
    description:
      "Restore automatic Streambot channel routing (e.g. 'automatic channel', 'channel auto').",
  },
];

const FALLBACK_INTENT_CHOICES: readonly DecisionChoiceOption[] = [
  {
    value: "non_command",
    description:
      "Accidental wake trigger, self-cancellation ('actually never mind', 'cancel'), or background conversation not asking Streambot to do or answer anything.",
  },
  {
    value: "delegate_realtime",
    description:
      "Any request needing open arguments, media search, numbers, volume, seeking, subtitle language/auto, sports listings, spoken status answers, channel 3+, or compound actions.",
  },
];

export type ClosedVoiceCommandIntent =
  | "pause"
  | "resume"
  | "skip"
  | "previous"
  | "restart"
  | "stop"
  | "clear"
  | "shuffle"
  | "subtitles_off"
  | "loop_off"
  | "loop_track"
  | "loop_queue"
  | "channel_1"
  | "channel_2"
  | "channel_auto";

type ClosedIntentExecutionSpec = {
  readonly toolName: ToolName;
  readonly toolArguments: Record<string, unknown>;
  readonly execute: (signal: AbortSignal) => string | Promise<string>;
};

export type CreateVoiceDecisionsRuntimeOptions = {
  readonly apiKey: string;
  readonly metricsRegister?: Registry | undefined;
  readonly fetch?: VoiceDecisionsRuntimeFetch | undefined;
  readonly logger?: LlmRuntimeLogger | undefined;
};

let cachedProductionRuntime: {
  readonly apiKey: string;
  readonly runtime: LlmRuntime;
} | null = null;

export function createVoiceDecisionsRuntime(
  options: CreateVoiceDecisionsRuntimeOptions,
): LlmRuntime {
  return createLlmRuntime({
    service: "streambot",
    appName: "Streambot",
    credentials: { openai: { apiKey: options.apiKey } },
    metricsRegister: options.metricsRegister ?? register,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
}

export function getOrCreateVoiceDecisionsRuntime(
  options: CreateVoiceDecisionsRuntimeOptions,
): LlmRuntime {
  if (
    options.fetch !== undefined ||
    options.metricsRegister !== undefined ||
    options.logger !== undefined
  ) {
    return createVoiceDecisionsRuntime(options);
  }
  if (cachedProductionRuntime?.apiKey === options.apiKey) {
    return cachedProductionRuntime.runtime;
  }
  const runtime = createVoiceDecisionsRuntime(options);
  cachedProductionRuntime = { apiKey: options.apiKey, runtime };
  return runtime;
}

function buildIntentChoices(
  commands: VoiceCommandPort,
): readonly DecisionChoiceOption[] {
  return commands.selectChannel === undefined
    ? [...BASE_INTENT_CHOICES, ...FALLBACK_INTENT_CHOICES]
    : [
        ...BASE_INTENT_CHOICES,
        ...NUMBERED_CHANNEL_CHOICES,
        ...FALLBACK_INTENT_CHOICES,
      ];
}

function resolveClosedIntent(
  intent: string,
  commands: VoiceCommandPort,
): ClosedIntentExecutionSpec | null {
  switch (intent) {
    case "pause": {
      return {
        toolName: "pause",
        toolArguments: {},
        execute: () => commands.pause(),
      };
    }
    case "resume": {
      return {
        toolName: "resume",
        toolArguments: {},
        execute: () => commands.resume(),
      };
    }
    case "skip": {
      return {
        toolName: "skip",
        toolArguments: {},
        execute: () => commands.skip(),
      };
    }
    case "previous": {
      return {
        toolName: "previous",
        toolArguments: {},
        execute: (signal) => commands.previous(signal),
      };
    }
    case "restart": {
      return {
        toolName: "restart",
        toolArguments: {},
        execute: () => commands.restart(),
      };
    }
    case "stop": {
      return {
        toolName: "stop",
        toolArguments: {},
        execute: () => commands.stop(),
      };
    }
    case "clear": {
      return {
        toolName: "clear",
        toolArguments: {},
        execute: () => commands.clear(),
      };
    }
    case "shuffle": {
      return {
        toolName: "shuffle",
        toolArguments: {},
        execute: () => commands.shuffle(),
      };
    }
    case "subtitles_off": {
      return {
        toolName: "subtitles_off",
        toolArguments: {},
        execute: () => commands.subtitlesOff(),
      };
    }
    case "loop_off": {
      return {
        toolName: "set_loop",
        toolArguments: { mode: "off" },
        execute: () => commands.setLoop("off"),
      };
    }
    case "loop_track": {
      return {
        toolName: "set_loop",
        toolArguments: { mode: "track" },
        execute: () => commands.setLoop("track"),
      };
    }
    case "loop_queue": {
      return {
        toolName: "set_loop",
        toolArguments: { mode: "queue" },
        execute: () => commands.setLoop("queue"),
      };
    }
    case "channel_1": {
      return resolveNumberedChannelIntent(commands, 1);
    }
    case "channel_2": {
      return resolveNumberedChannelIntent(commands, 2);
    }
    case "channel_auto": {
      return resolveNumberedChannelIntent(commands, "auto");
    }
    default: {
      return null;
    }
  }
}

function resolveNumberedChannelIntent(
  commands: VoiceCommandPort,
  channel: 1 | 2 | "auto",
): ClosedIntentExecutionSpec | null {
  const selectChannel = commands.selectChannel;
  if (selectChannel === undefined) return null;
  return {
    toolName: "select_channel",
    toolArguments: { channel },
    execute: () => selectChannel(channel),
  };
}

const StringChoiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  confidence: z.number(),
});

export type CreateStreambotVoiceCommandRouterOptions = {
  readonly commands: VoiceCommandPort;
  readonly runtime: LlmRuntime;
};

export function createStreambotVoiceCommandRouter(
  options: CreateStreambotVoiceCommandRouterOptions,
): RealtimeVerifiedCommandRouter {
  const choices = buildIntentChoices(options.commands);
  return async (
    input: RealtimeVerifiedCommandRouteInput,
  ): Promise<RealtimeVerifiedCommandRouteResult> => {
    const decision = await options.runtime.decide({
      model: VOICE_DECISIONS_MODEL,
      workload: VOICE_DECISIONS_WORKLOAD,
      promptCacheKey: VOICE_DECISIONS_PROMPT_CACHE_KEY,
      system: [
        {
          type: "input_text",
          text: STATIC_VOICE_ROUTER_SYSTEM_PROMPT,
          prompt_cache_breakpoint: true,
        },
      ],
      input: input.command,
      abortSignal: input.signal,
      questions: [
        {
          type: "choice",
          name: "intent",
          instructions: VOICE_ROUTER_QUESTION_INSTRUCTIONS,
          choices,
        },
      ],
    });

    const answer = decision.answerByName("intent");
    const parsedChoice = StringChoiceAnswerSchema.safeParse(answer);
    trace.getActiveSpan()?.setAttributes({
      "streambot.voice.decisions.answer_type": answer?.type ?? "missing",
      "streambot.voice.decisions.intent": parsedChoice.success
        ? parsedChoice.data.choice
        : "none",
      "streambot.voice.decisions.confidence": parsedChoice.success
        ? parsedChoice.data.confidence
        : -1,
    });

    if (
      !parsedChoice.success ||
      parsedChoice.data.confidence < VOICE_DECISIONS_CONFIDENCE_THRESHOLD ||
      parsedChoice.data.choice === "delegate_realtime"
    ) {
      return { handled: false };
    }

    if (parsedChoice.data.choice === "non_command") {
      return {
        handled: true,
        toolCalls: [],
        mutated: false,
      };
    }

    const spec = resolveClosedIntent(
      parsedChoice.data.choice,
      options.commands,
    );
    if (spec === null) {
      return { handled: false };
    }

    const result = await invokeStreambotVoiceTool({
      commands: options.commands,
      mutationGate: input.mutationGate,
      transactionSignal: input.signal,
      attempt: input.attempt,
      name: spec.toolName,
      mutating: true,
      toolArguments: spec.toolArguments,
      operation: () => spec.execute(input.signal),
    });

    return {
      handled: true,
      toolCalls: [spec.toolName],
      mutated: input.mutationGate.hasMutated,
      assistantText: result,
    };
  };
}
