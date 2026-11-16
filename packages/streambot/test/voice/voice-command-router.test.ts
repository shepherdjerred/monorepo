import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { NoopProvider } from "@shepherdjerred/feature-flags/providers/noop.ts";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";
import { VoiceMutationGate } from "@shepherdjerred/voice-assistant/mutation-gate.ts";
import {
  NOOP_VOICE_ATTEMPT_OBSERVER,
  type VoiceAttemptHandle,
  type VoiceToolObservation,
} from "@shepherdjerred/voice-assistant/realtime/attempt.ts";
import type { AssistantAudioSink } from "@shepherdjerred/voice-assistant";
import { Registry } from "prom-client";
import { afterEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { PlaybackCommandService } from "@shepherdjerred/streambot/commands/playback-command-service.ts";
import { PlaybackCommandBoundaryError } from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import { mediaFeatureGate } from "@shepherdjerred/streambot/config/media-features.ts";
import { UserIdSchema } from "@shepherdjerred/streambot/types/ids.ts";
import { DryRunVoiceCommandPort } from "@shepherdjerred/streambot/voice/local-voice-probe.ts";
import {
  createStreambotVoiceCommandRouter,
  createVoiceDecisionsRuntime,
  STATIC_VOICE_ROUTER_SYSTEM_PROMPT,
  type VoiceDecisionsRuntimeFetch,
} from "@shepherdjerred/streambot/voice/voice-command-router.ts";
import type { VoiceCommandPort } from "@shepherdjerred/streambot/voice/voice-tools.ts";

const USER = UserIdSchema.parse("100000000000000001");

const silentAudioSink: AssistantAudioSink = {
  enqueue: () => {
    /* Routed closed commands emit no audio. */
  },
  finish: () => Promise.resolve(),
  cancel: () => Promise.resolve(),
};

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function decisionChoiceResponse(choice: string, confidence = 0.95): Response {
  return Response.json(
    {
      id: "dec_voice_test",
      model: "gpt-6-luna-2026-11",
      answers: [
        {
          type: "choice",
          name: "intent",
          choice,
          confidence,
          probabilities: [{ value: choice, probability: confidence }],
        },
      ],
      usage: {
        input_tokens: 180,
        input_tokens_details: {
          cached_tokens: 140,
          cache_write_tokens: 0,
        },
        output_tokens: 4,
        output_tokens_details: {
          reasoning_tokens: 0,
        },
        total_tokens: 184,
      },
    },
    { status: 200, headers: { "x-request-id": "req_voice_decision" } },
  );
}

function decisionRefusalResponse(): Response {
  return Response.json(
    {
      id: "dec_voice_refusal",
      model: "gpt-6-luna-2026-11",
      answers: [
        {
          type: "refusal",
          name: "intent",
        },
      ],
      usage: {
        input_tokens: 160,
        output_tokens: 2,
        total_tokens: 162,
      },
    },
    { status: 200 },
  );
}

const JsonRecordSchema = z.record(z.string(), z.unknown());
const SentQuestionsSchema = z.object({
  questions: z.array(
    z.object({
      choices: z.array(z.object({ value: z.union([z.string(), z.boolean()]) })),
    }),
  ),
});

function extendDryRunPort(
  basePort: DryRunVoiceCommandPort,
  overrides: Partial<VoiceCommandPort>,
): VoiceCommandPort {
  return {
    play: basePort.play.bind(basePort),
    skip: basePort.skip.bind(basePort),
    stop: basePort.stop.bind(basePort),
    seek: basePort.seek.bind(basePort),
    setVolume: basePort.setVolume.bind(basePort),
    setLoop: basePort.setLoop.bind(basePort),
    shuffle: basePort.shuffle.bind(basePort),
    remove: basePort.remove.bind(basePort),
    clear: basePort.clear.bind(basePort),
    move: basePort.move.bind(basePort),
    jumpToChapter: basePort.jumpToChapter.bind(basePort),
    subtitlesOff: basePort.subtitlesOff.bind(basePort),
    subtitles: basePort.subtitles.bind(basePort),
    pause: basePort.pause.bind(basePort),
    resume: basePort.resume.bind(basePort),
    restart: basePort.restart.bind(basePort),
    previous: basePort.previous.bind(basePort),
    searchLibrary: basePort.searchLibrary.bind(basePort),
    searchMedia: basePort.searchMedia.bind(basePort),
    listChapters: basePort.listChapters.bind(basePort),
    getQueue: basePort.getQueue.bind(basePort),
    getNowPlaying: basePort.getNowPlaying.bind(basePort),
    ...overrides,
  };
}

function createRouterHarness(options: {
  readonly responder: (body: Record<string, unknown>) => Response;
  readonly commands?: VoiceCommandPort;
}) {
  const seenRequests: {
    url: string;
    method: string;
    authorization: string | null;
    body: Record<string, unknown>;
  }[] = [];
  const metricsRegister = new Registry();
  const toolObservations: VoiceToolObservation[] = [];
  const dryRun = new DryRunVoiceCommandPort();
  const commands = options.commands ?? dryRun;

  const fetcher: VoiceDecisionsRuntimeFetch = (input, init) => {
    const rawBody = typeof init?.body === "string" ? init.body : "{}";
    const parsedBody = JsonRecordSchema.parse(JSON.parse(rawBody));
    const headers = new Headers(init?.headers);
    seenRequests.push({
      url: requestUrl(input),
      method: init?.method ?? "GET",
      authorization: headers.get("authorization"),
      body: parsedBody,
    });
    return Promise.resolve(options.responder(parsedBody));
  };

  const runtime = createVoiceDecisionsRuntime({
    apiKey: "sk-streambot-voice-test",
    metricsRegister,
    fetch: fetcher,
    logger: () => {
      /* Silence runtime logs in test. */
    },
  });
  const router = createStreambotVoiceCommandRouter({ commands, runtime });

  const baseAttempt = NOOP_VOICE_ATTEMPT_OBSERVER.begin();
  const attempt: VoiceAttemptHandle = {
    ...baseAttempt,
    tool: (observation) => {
      toolObservations.push(observation);
    },
  };

  return {
    seenRequests,
    metricsRegister,
    toolObservations,
    dryRun,
    route: async (command: string, signal = new AbortController().signal) => {
      const mutationGate = new VoiceMutationGate();
      const decision = await router({
        command,
        transcript: `Hey Streambot, ${command}`,
        signal,
        mutationGate,
        attempt,
        assistantAudio: silentAudioSink,
      });
      return { decision, mutationGate };
    },
  };
}

describe("Streambot voice Decisions wire contract and closed intents", () => {
  test("posts expected gpt-6-luna prompt-cached contract to /v1/decisions and records Prometheus metrics", async () => {
    const harness = createRouterHarness({
      responder: () => decisionChoiceResponse("pause", 0.96),
    });

    const { decision, mutationGate } = await harness.route("pause");

    expect(decision).toEqual({
      handled: true,
      toolCalls: ["pause"],
      mutated: true,
      assistantText: "Dry run: playback would pause.",
    });
    expect(mutationGate.hasMutated).toBe(true);
    expect(harness.seenRequests).toHaveLength(1);
    const request = harness.seenRequests[0];
    expect(request?.url).toBe("https://api.openai.com/v1/decisions");
    expect(request?.method).toBe("POST");
    expect(request?.authorization).toBe("Bearer sk-streambot-voice-test");
    expect(request?.body).toMatchObject({
      model: "gpt-6-luna",
      prompt_cache_key: "streambot:voice-intent:v1",
      system: [
        {
          type: "input_text",
          text: STATIC_VOICE_ROUTER_SYSTEM_PROMPT,
          prompt_cache_breakpoint: true,
        },
      ],
      input: "pause",
      questions: [
        {
          type: "choice",
          name: "intent",
        },
      ],
    });

    const metricsText = await harness.metricsRegister.metrics();
    expect(metricsText).toContain(
      'llm_requests_total{service="streambot",workload="voice-command-intent",provider="openai",model="gpt-6-luna",outcome="success"} 1',
    );
    expect(metricsText).toContain(
      'llm_tokens_total{service="streambot",workload="voice-command-intent",provider="openai",model="gpt-6-luna",type="cached_input"} 140',
    );
  });

  test.each([
    ["pause", "pause", { name: "pause", arguments: {} }],
    ["resume", "resume", { name: "resume", arguments: {} }],
    ["skip", "skip", { name: "skip", arguments: {} }],
    ["previous", "previous", { name: "previous", arguments: {} }],
    ["restart", "restart", { name: "restart", arguments: {} }],
    ["stop", "stop", { name: "stop", arguments: {} }],
    ["clear", "clear", { name: "clear", arguments: {} }],
    ["shuffle", "shuffle", { name: "shuffle", arguments: {} }],
    [
      "subtitles_off",
      "subtitles_off",
      { name: "subtitles_off", arguments: {} },
    ],
    ["loop_off", "set_loop", { name: "set_loop", arguments: { mode: "off" } }],
    [
      "loop_track",
      "set_loop",
      { name: "set_loop", arguments: { mode: "track" } },
    ],
    [
      "loop_queue",
      "set_loop",
      { name: "set_loop", arguments: { mode: "queue" } },
    ],
  ] as const)(
    "executes closed intent %s via VoiceCommandPort at confidence >= 0.80",
    async (intent, expectedToolName, expectedInvocation) => {
      const harness = createRouterHarness({
        responder: () => decisionChoiceResponse(intent, 0.8),
      });

      const { decision, mutationGate } = await harness.route(intent);

      expect(decision.handled).toBe(true);
      if (decision.handled) {
        expect(decision.toolCalls).toEqual([expectedToolName]);
        expect(decision.mutated).toBe(true);
      }
      expect(mutationGate.hasMutated).toBe(true);
      expect(harness.dryRun.invocations).toEqual([expectedInvocation]);
      expect(harness.toolObservations).toEqual([
        expect.objectContaining({
          name: expectedToolName,
          outcome: "success",
        }),
      ]);
    },
  );

  test("includes numbered channel choices only when selectChannel is available on VoiceCommandPort", async () => {
    const selectedChannels: (number | "auto")[] = [];
    const basePort = new DryRunVoiceCommandPort();
    const numberedPort = extendDryRunPort(basePort, {
      selectChannel: (channel) => {
        selectedChannels.push(channel);
        return `Selected channel ${String(channel)}.`;
      },
    });

    for (const [intent, expectedTarget] of [
      ["channel_1", 1],
      ["channel_2", 2],
      ["channel_auto", "auto"],
    ] as const) {
      const harness = createRouterHarness({
        commands: numberedPort,
        responder: () => decisionChoiceResponse(intent, 0.92),
      });
      const { decision } = await harness.route(`switch to ${intent}`);
      expect(decision).toEqual({
        handled: true,
        toolCalls: ["select_channel"],
        mutated: true,
        assistantText: `Selected channel ${String(expectedTarget)}.`,
      });
    }
    expect(selectedChannels).toEqual([1, 2, "auto"]);

    const unnumberedHarness = createRouterHarness({
      responder: () => decisionChoiceResponse("channel_1", 0.95),
    });
    const unnumberedResult = await unnumberedHarness.route("channel 1");
    const sentPayload = SentQuestionsSchema.parse(
      unnumberedHarness.seenRequests[0]?.body,
    );
    expect(
      sentPayload.questions[0]?.choices.some((c) => c.value === "channel_1"),
    ).toBe(false);
    expect(unnumberedResult.decision).toEqual({ handled: false });
  });
});

describe("Streambot voice Decisions thresholds, gates, and feature flag", () => {
  afterEach(async () => {
    await shutdownFeatureFlags();
  });

  test("short-circuits high-confidence non_command without executing tools or mutating", async () => {
    const harness = createRouterHarness({
      responder: () => decisionChoiceResponse("non_command", 0.91),
    });

    const { decision, mutationGate } = await harness.route(
      "actually never mind",
    );

    expect(decision).toEqual({
      handled: true,
      toolCalls: [],
      mutated: false,
    });
    expect(mutationGate.hasMutated).toBe(false);
    expect(harness.dryRun.invocations).toEqual([]);
    expect(harness.toolObservations).toEqual([]);
  });

  test("returns handled: false for delegate_realtime, confidence below 0.80, and refusal answers", async () => {
    for (const openCommand of [
      "play bohemian rhapsody",
      "set volume to 35",
      "what sports are on?",
    ]) {
      const delegated = createRouterHarness({
        responder: () => decisionChoiceResponse("delegate_realtime", 0.98),
      });
      const { decision } = await delegated.route(openCommand);
      expect(decision).toEqual({ handled: false });
      expect(delegated.dryRun.invocations).toEqual([]);
    }

    const lowConfidence = createRouterHarness({
      responder: () => decisionChoiceResponse("pause", 0.62),
    });
    const lowConfidenceOutcome = await lowConfidence.route("pause");
    expect(lowConfidenceOutcome.decision).toEqual({
      handled: false,
    });
    expect(lowConfidence.dryRun.invocations).toEqual([]);

    const refusal = createRouterHarness({
      responder: () => decisionRefusalResponse(),
    });
    const refusalOutcome = await refusal.route("pause");
    expect(refusalOutcome.decision).toEqual({
      handled: false,
    });
    expect(refusal.dryRun.invocations).toEqual([]);
  });

  test("preserves assistantV2 gating and boundary-error mutation release on routed tools", async () => {
    const basePort = new DryRunVoiceCommandPort();
    const gatedPort = extendDryRunPort(basePort, {
      stop: () => {
        throw new PlaybackCommandBoundaryError(
          "Only an admin can stop playback.",
        );
      },
      isAssistantV2Enabled: () => Promise.resolve(false),
    });

    const disabledPause = createRouterHarness({
      commands: gatedPort,
      responder: () => decisionChoiceResponse("pause", 0.95),
    });
    const pauseOutcome = await disabledPause.route("pause");
    expect(pauseOutcome.decision).toEqual({
      handled: true,
      toolCalls: ["pause"],
      mutated: false,
      assistantText: "That advanced playback control is not enabled here.",
    });
    expect(basePort.invocations).toEqual([]);

    const deniedStop = createRouterHarness({
      commands: gatedPort,
      responder: () => decisionChoiceResponse("stop", 0.95),
    });
    const stopOutcome = await deniedStop.route("stop");
    expect(stopOutcome.decision).toEqual({
      handled: true,
      toolCalls: ["stop"],
      mutated: false,
      assistantText: "Only an admin can stop playback.",
    });
    expect(stopOutcome.mutationGate.hasMutated).toBe(false);
  });

  test("evaluates streambot-voice-decisions-router-enabled with default true and respects explicit false", async () => {
    const scope = {
      guildId: "100000000000000010",
      channelId: "100000000000000020",
      userId: String(USER),
    };

    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "disabled" },
      provider: new NoopProvider(),
    });
    expect(await mediaFeatureGate.voiceDecisionsRouter?.(scope)).toBe(true);
    await shutdownFeatureFlags();

    await initFeatureFlags({
      environment: { FEATURE_FLAGS_MODE: "static" },
      provider: new StaticProvider({
        "streambot-voice-decisions-router-enabled": false,
      }),
    });
    expect(await mediaFeatureGate.voiceDecisionsRouter?.(scope)).toBe(false);

    const config = loadConfig({
      BOT_TOKEN: "bot",
      USER_TOKENS: "userbot",
      VIDEOS_DIR: "/videos",
    });
    const service = new PlaybackCommandService({
      config,
      dispatch: () => {
        /* Unused in flag check. */
      },
      view: () => ({
        state: "idle",
        current: null,
        queue: [],
        loop: "off",
        volume: 100,
        positionSeconds: null,
      }),
      library: () => [],
      setVolume: () => Promise.resolve(true),
      seek: () => Promise.resolve(true),
      resolvePlaySource: () => Promise.reject(new Error("unused")),
      announce: () => Promise.resolve(),
      guildId: scope.guildId,
      channelId: scope.channelId,
      featureGate: mediaFeatureGate,
    });
    expect(service.hasVoiceDecisionsRouterGate()).toBe(true);
    expect(await service.isVoiceDecisionsRouterEnabled(USER)).toBe(false);
  });
});
