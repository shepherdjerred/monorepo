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
import type { TvPreset } from "@shepherdjerred/streambot/state/station-schema.ts";
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
- radio_start, radio_stop (only when no artist/genre/mood seed or scope is specified)
- tv_start, tv_continue_series, tv_sitcoms, tv_movies, tv_youtube, tv_stop (only when no show/topic/genre seed or scope is specified)
- channel_1, channel_2, channel_auto (only when those choices are listed)

Choose non_command ONLY when the utterance is an accidental wake trigger, empty filler, self-cancellation ("never mind", "cancel that", "ignore me"), or background conversation clearly not asking Streambot to act or answer.

Choose delegate_realtime for EVERYTHING else, including:
- playing or searching any song, video, movie, show, artist, character cover, or sports match
- seeded or scoped radio or TV requests ("start jazz radio", "play my radio", "start sci-fi tv", "my tv")
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

const opt = (value: string, description: string): DecisionChoiceOption => ({
  value,
  description,
});

const BASE_INTENT_CHOICES: readonly DecisionChoiceOption[] = [
  opt(
    "pause",
    "Pause current playback immediately (e.g. 'pause', 'pause the video', 'hold on').",
  ),
  opt(
    "resume",
    "Resume or unpause paused playback (e.g. 'resume', 'unpause', 'continue playing').",
  ),
  opt(
    "skip",
    "Skip the current item to play the next queued item (e.g. 'skip', 'next', 'next track', 'skip this').",
  ),
  opt(
    "previous",
    "Play the previous item from server history again (e.g. 'previous', 'previous track', 'play the previous song'). Relative time seeks like 'go back 30 seconds' must use delegate_realtime.",
  ),
  opt(
    "restart",
    "Restart the currently playing item from the beginning (e.g. 'restart', 'start over', 'from the beginning').",
  ),
  opt(
    "stop",
    "Stop playback completely and clear the queue (e.g. 'stop', 'stop playback', 'stop playing').",
  ),
  opt(
    "clear",
    "Clear all queued items without stopping the current item (e.g. 'clear queue', 'clear the queue', 'empty queue').",
  ),
  opt(
    "shuffle",
    "Shuffle the queued items (e.g. 'shuffle', 'shuffle the queue').",
  ),
  opt(
    "subtitles_off",
    "Turn subtitles or captions off for the current video (e.g. 'turn off subtitles', 'subtitles off', 'disable captions'). Enabling subtitles or selecting a language must use delegate_realtime.",
  ),
  opt(
    "loop_off",
    "Turn looping off (e.g. 'loop off', 'turn looping off', 'stop looping').",
  ),
  opt(
    "loop_track",
    "Loop the current single track or video (e.g. 'loop this track', 'loop song', 'repeat one').",
  ),
  opt(
    "loop_queue",
    "Loop the full playback queue (e.g. 'loop the queue', 'loop all', 'repeat queue').",
  ),
];

const RADIO_INTENT_CHOICES: readonly DecisionChoiceOption[] = [
  opt(
    "radio_start",
    "Start unseeded continuous Radio mode (e.g. 'put on radio', 'start radio', 'turn on radio'). Seeded or scoped radio ('start jazz radio', 'my radio') must use delegate_realtime.",
  ),
  opt(
    "radio_stop",
    "Stop active Radio station refilling (e.g. 'stop radio', 'turn off radio').",
  ),
];

const TV_INTENT_CHOICES: readonly DecisionChoiceOption[] = [
  opt(
    "tv_start",
    "Start unseeded continuous TV mode with the default My Mix preset (e.g. 'start tv', 'turn on tv', 'put on tv'). Seeded or scoped TV ('start sci-fi tv', 'my tv') must use delegate_realtime.",
  ),
  opt(
    "tv_continue_series",
    "Start unseeded continuous TV mode on the Continue Series preset (e.g. 'start continue series tv', 'continue series tv').",
  ),
  opt(
    "tv_sitcoms",
    "Start unseeded continuous TV mode on the Sitcoms preset (e.g. 'put on sitcoms tv', 'start sitcoms tv').",
  ),
  opt(
    "tv_movies",
    "Start unseeded continuous TV mode on the Movies preset (e.g. 'put on movies tv', 'start movies tv').",
  ),
  opt(
    "tv_youtube",
    "Start unseeded continuous TV mode on the YouTube preset (e.g. 'put on youtube tv', 'start youtube tv').",
  ),
  opt(
    "tv_stop",
    "Stop active TV station refilling (e.g. 'stop tv', 'turn off tv').",
  ),
];

const NUMBERED_CHANNEL_CHOICES: readonly DecisionChoiceOption[] = [
  opt(
    "channel_1",
    "Select Streambot playback channel 1 (mic audio) without starting media (e.g. 'channel 1', 'switch to channel one').",
  ),
  opt(
    "channel_2",
    "Select Streambot playback channel 2 (Go Live video) without starting media (e.g. 'channel 2', 'switch to channel two').",
  ),
  opt(
    "channel_auto",
    "Restore automatic Streambot channel routing (e.g. 'automatic channel', 'channel auto').",
  ),
];

const FALLBACK_INTENT_CHOICES: readonly DecisionChoiceOption[] = [
  opt(
    "non_command",
    "Accidental wake trigger, self-cancellation ('actually never mind', 'cancel'), or background conversation not asking Streambot to do or answer anything.",
  ),
  opt(
    "delegate_realtime",
    "Any request needing open arguments, media search, numbers, volume, seeking, subtitle language/auto, sports listings, spoken status answers, channel 3+, or compound actions.",
  ),
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
  | "radio_start"
  | "radio_stop"
  | "tv_start"
  | "tv_continue_series"
  | "tv_sitcoms"
  | "tv_movies"
  | "tv_youtube"
  | "tv_stop"
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
  return [
    ...BASE_INTENT_CHOICES,
    ...(commands.radio === undefined ? [] : RADIO_INTENT_CHOICES),
    ...(commands.tv === undefined ? [] : TV_INTENT_CHOICES),
    ...(commands.selectChannel === undefined ? [] : NUMBERED_CHANNEL_CHOICES),
    ...FALLBACK_INTENT_CHOICES,
  ];
}

const TV_PRESET_BY_INTENT: Readonly<
  Record<string, { action: "start" | "stop"; preset?: TvPreset }>
> = {
  tv_start: { action: "start" },
  tv_continue_series: { action: "start", preset: "continue-series" },
  tv_sitcoms: { action: "start", preset: "sitcoms" },
  tv_movies: { action: "start", preset: "movies" },
  tv_youtube: { action: "start", preset: "youtube" },
  tv_stop: { action: "stop" },
};

const bareSpec = (
  toolName: ToolName,
  execute: ClosedIntentExecutionSpec["execute"],
): ClosedIntentExecutionSpec => ({ toolName, toolArguments: {}, execute });
const loopSpec = (
  commands: VoiceCommandPort,
  mode: "off" | "track" | "queue",
): ClosedIntentExecutionSpec => ({
  toolName: "set_loop",
  toolArguments: { mode },
  execute: () => commands.setLoop(mode),
});

function resolveBaseIntent(
  intent: string,
  commands: VoiceCommandPort,
): ClosedIntentExecutionSpec | null {
  const simple: Record<string, ClosedIntentExecutionSpec | undefined> = {
    pause: bareSpec("pause", () => commands.pause()),
    resume: bareSpec("resume", () => commands.resume()),
    skip: bareSpec("skip", () => commands.skip()),
    previous: bareSpec("previous", (signal) => commands.previous(signal)),
    restart: bareSpec("restart", () => commands.restart()),
    stop: bareSpec("stop", () => commands.stop()),
    clear: bareSpec("clear", () => commands.clear()),
    shuffle: bareSpec("shuffle", () => commands.shuffle()),
    subtitles_off: bareSpec("subtitles_off", () => commands.subtitlesOff()),
    loop_off: loopSpec(commands, "off"),
    loop_track: loopSpec(commands, "track"),
    loop_queue: loopSpec(commands, "queue"),
  };
  return Object.hasOwn(simple, intent) ? (simple[intent] ?? null) : null;
}

function resolveClosedIntent(
  intent: string,
  commands: VoiceCommandPort,
): ClosedIntentExecutionSpec | null {
  const base = resolveBaseIntent(intent, commands);
  if (base !== null) return base;
  if (intent === "radio_start") return resolveRadioIntent(commands, "start");
  if (intent === "radio_stop") return resolveRadioIntent(commands, "stop");
  if (Object.hasOwn(TV_PRESET_BY_INTENT, intent)) {
    const tvSpec = TV_PRESET_BY_INTENT[intent];
    return tvSpec === undefined ? null : resolveTvIntent(commands, tvSpec);
  }
  if (intent === "channel_1") return resolveNumberedChannelIntent(commands, 1);
  if (intent === "channel_2") return resolveNumberedChannelIntent(commands, 2);
  return intent === "channel_auto"
    ? resolveNumberedChannelIntent(commands, "auto")
    : null;
}

function resolveTvIntent(
  commands: VoiceCommandPort,
  args: { readonly action: "start" | "stop"; readonly preset?: TvPreset },
): ClosedIntentExecutionSpec | null {
  const tv = commands.tv;
  if (tv === undefined) return null;
  const payload =
    args.preset === undefined
      ? { action: args.action }
      : { action: args.action, preset: args.preset };
  return {
    toolName: "tv",
    toolArguments: payload,
    execute: (signal) => tv.call(commands, payload, signal),
  };
}

function resolveRadioIntent(
  commands: VoiceCommandPort,
  action: "start" | "stop",
): ClosedIntentExecutionSpec | null {
  const radio = commands.radio;
  if (radio === undefined) return null;
  return {
    toolName: "radio",
    toolArguments: { action },
    execute: (signal) => radio.call(commands, { action }, signal),
  };
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
