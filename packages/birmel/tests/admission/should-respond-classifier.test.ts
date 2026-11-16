import { trace } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-base";
import { StaticProvider } from "@shepherdjerred/feature-flags/providers/static.ts";
import { resetOtelGlobals } from "@shepherdjerred/llm-observability/otel-globals";
import { createLlmRuntime } from "@shepherdjerred/llm-runtime";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import {
  resetLlmRuntime,
  setLlmRuntime,
} from "@shepherdjerred/birmel/agent-runtime/llm.ts";
import {
  initializeDynamicConfig,
  shutdownDynamicConfig,
} from "@shepherdjerred/birmel/config/dynamic.ts";
import { getConfig, resetConfig } from "@shepherdjerred/birmel/config/index.ts";
import { classifyShouldRespond } from "@shepherdjerred/birmel/discord/should-respond-classifier.ts";
import { metricsRegister } from "@shepherdjerred/birmel/observability/metrics.ts";

const DISABLED_FLAGS_ENV = { FEATURE_FLAGS_MODE: "disabled" } as const;

const DecisionsWireBodySchema = z.strictObject({
  model: z.string(),
  system: z.array(
    z.strictObject({
      type: z.literal("input_text"),
      text: z.string(),
      prompt_cache_breakpoint: z.boolean().optional(),
    }),
  ),
  input: z.string(),
  questions: z.array(
    z.strictObject({
      type: z.literal("predicate"),
      name: z.string(),
      instructions: z.string(),
    }),
  ),
  prompt_cache_key: z.string(),
});

const ResponsesWireBodySchema = z
  .object({
    model: z.string(),
    text: z.object({
      format: z
        .object({
          type: z.literal("json_schema"),
          name: z.literal("birmel_should_respond"),
        })
        .loose(),
    }),
  })
  .loose();

type RecordedRequest = {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
};

function decisionsApiResponse(
  answer:
    | {
        readonly type: "predicate";
        readonly name: string | null;
        readonly probability: number;
      }
    | {
        readonly type: "refusal";
        readonly name: string | null;
      },
): Response {
  return Response.json(
    {
      id: "dec_should_respond_test",
      model: "gpt-6-luna-2026-10-01",
      answers: [answer],
      usage: {
        input_tokens: 180,
        input_tokens_details: {
          cached_tokens: 120,
          cache_write_tokens: 0,
        },
        output_tokens: 16,
        output_tokens_details: {
          reasoning_tokens: 12,
        },
        total_tokens: 196,
      },
    },
    { status: 200 },
  );
}

function responsesApiResponse(payload: {
  readonly shouldRespond: boolean;
  readonly reason: string | null;
}): Response {
  return Response.json({
    id: "resp_should_respond_fallback",
    object: "response",
    model: "gpt-6-luna",
    status: "completed",
    output: [
      {
        type: "message",
        id: "msg_should_respond_fallback",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: JSON.stringify(payload),
            annotations: [],
          },
        ],
      },
    ],
    usage: {
      input_tokens: 140,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 12,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 152,
    },
  });
}

function installTestRuntime(
  respond: (url: string, init: RequestInit | undefined) => Promise<Response>,
): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  const runtime = createLlmRuntime({
    credentials: { openai: { apiKey: "test-openai-key" } },
    service: "birmel-test",
    appName: "Birmel Test",
    fetch: async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const rawBody = typeof init?.body === "string" ? init.body : "{}";
      requests.push({
        url,
        method: init?.method ?? "GET",
        body: JSON.parse(rawBody),
      });
      return await respond(url, init);
    },
  });
  setLlmRuntime(runtime);
  return requests;
}

async function admissionOutcomeCount(outcome: string): Promise<number> {
  const metric = await metricsRegister
    .getSingleMetric("birmel_admission_classifier_total")
    ?.get();
  return (
    metric?.values.find(({ labels }) => labels["outcome"] === outcome)?.value ??
    0
  );
}

function findAdmissionSpan(spans: readonly ReadableSpan[]): ReadableSpan {
  const found = spans.find((span) => span.name === "birmel.admission.classify");
  if (found === undefined) {
    throw new Error("Expected birmel.admission.classify span to be recorded");
  }
  return found;
}

let exporter: InMemorySpanExporter;
let tracerProvider: BasicTracerProvider;

beforeEach(() => {
  resetConfig();
  resetLlmRuntime();
  resetOtelGlobals();
  exporter = new InMemorySpanExporter();
  tracerProvider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  trace.setGlobalTracerProvider(tracerProvider);
});

afterEach(async () => {
  await shutdownDynamicConfig();
  resetLlmRuntime();
  resetConfig();
  await tracerProvider.shutdown();
  resetOtelGlobals();
});

describe("classifyShouldRespond Decisions API thresholds and caching", () => {
  test("sends POST /v1/decisions with gpt-6-luna, guild cache key, and system prompt_cache_breakpoint, returning true when probability >= 0.5", async () => {
    const respondBefore = await admissionOutcomeCount("respond");
    const requests = installTestRuntime(() =>
      Promise.resolve(
        decisionsApiResponse({
          type: "predicate",
          name: "should_respond",
          probability: 0.5,
        }),
      ),
    );

    const decision = await classifyShouldRespond({
      persona: "virmel",
      transcript: "alice: hey birmel\nbirmel: what's up?",
      latestMessage: "alice: can you check tomorrow's schedule too?",
      guildId: "100000000000000042",
      channelId: "100000000000000099",
      userId: "186665676134547461",
      messageId: "100000000000000777",
    });

    expect(decision).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.openai.com/v1/decisions");
    expect(requests[0]?.method).toBe("POST");

    const wire = DecisionsWireBodySchema.parse(requests[0]?.body);
    expect(wire.model).toBe("gpt-6-luna");
    expect(wire.prompt_cache_key).toBe(
      "birmel:should-respond:100000000000000042",
    );
    expect(wire.system).toHaveLength(1);
    expect(wire.system[0]?.prompt_cache_breakpoint).toBe(true);
    expect(wire.system[0]?.text).toContain(
      "Decide whether the elected persona should reply to the latest Discord message.",
    );
    expect(wire.system[0]?.text).toContain("Elected persona");
    expect(wire.input).toContain(
      "Recent conversation:\nalice: hey birmel\nbirmel: what's up?",
    );
    expect(wire.input).toContain(
      "Latest message:\nalice: can you check tomorrow's schedule too?",
    );
    expect(wire.questions).toEqual([
      {
        type: "predicate",
        name: "should_respond",
        instructions:
          "Should the bot reply to the latest message right now as a natural peer participant in this Discord channel?",
      },
    ]);

    const span = findAdmissionSpan(exporter.getFinishedSpans());
    expect(span.attributes["classifier.probability"]).toBe(0.5);
    expect(span.attributes["classifier.threshold"]).toBe(0.5);
    expect(span.attributes["classifier.should_respond"]).toBe(true);
    expect(span.attributes["birmel.admission.should_respond"]).toBe(true);
    expect(await admissionOutcomeCount("respond")).toBe(respondBefore + 1);
  });

  test("returns false when predicate probability is below default decisionsThreshold (0.5)", async () => {
    const ignoreBefore = await admissionOutcomeCount("ignore");
    installTestRuntime(() =>
      Promise.resolve(
        decisionsApiResponse({
          type: "predicate",
          name: "should_respond",
          probability: 0.49,
        }),
      ),
    );

    const decision = await classifyShouldRespond({
      persona: "virmel",
      transcript: "",
      latestMessage: "bob: random side chat to charlie",
      guildId: "100000000000000042",
      channelId: "100000000000000099",
      userId: "186665676134547461",
    });

    expect(decision).toBe(false);
    const span = findAdmissionSpan(exporter.getFinishedSpans());
    expect(span.attributes["classifier.probability"]).toBe(0.49);
    expect(span.attributes["classifier.threshold"]).toBe(0.5);
    expect(span.attributes["classifier.should_respond"]).toBe(false);
    expect(span.attributes["birmel.admission.should_respond"]).toBe(false);
    expect(await admissionOutcomeCount("ignore")).toBe(ignoreBefore + 1);
  });

  test("respects custom decisionsThreshold (0.75) and persona disablement via dynamic flags", async () => {
    await initializeDynamicConfig({
      environment: DISABLED_FLAGS_ENV,
      config: getConfig(),
      startPolling: false,
      provider: new StaticProvider({
        "birmel-llm-decisions-threshold": 0.75,
        "birmel-persona-enabled": false,
      }),
    });

    const probabilities = [0.74, 0.75];
    const requests = installTestRuntime(() => {
      const next = probabilities.shift() ?? 0;
      return Promise.resolve(
        decisionsApiResponse({
          type: "predicate",
          name: "should_respond",
          probability: next,
        }),
      );
    });

    const below = await classifyShouldRespond({
      persona: "virmel",
      transcript: "",
      latestMessage: "alice: borderline follow-up",
      guildId: "100000000000000055",
      channelId: "100000000000000099",
      userId: "186665676134547461",
    });
    const atOrAbove = await classifyShouldRespond({
      persona: "virmel",
      transcript: "",
      latestMessage: "alice: direct continuation",
      guildId: "100000000000000055",
      channelId: "100000000000000099",
      userId: "186665676134547461",
    });

    expect(below).toBe(false);
    expect(atOrAbove).toBe(true);
    const wire = DecisionsWireBodySchema.parse(requests[0]?.body);
    expect(wire.system[0]?.prompt_cache_breakpoint).toBe(true);
    expect(wire.system[0]?.text).not.toContain("Elected persona");
    expect(wire.input).toContain("Recent conversation:\n(none)");
  });
});

describe("classifyShouldRespond refusal, errors, and Flipt rollback", () => {
  test("fails closed (false) and marks classifier.refusal when Decisions API returns a refusal", async () => {
    const refusalBefore = await admissionOutcomeCount("refusal");
    installTestRuntime(() =>
      Promise.resolve(
        decisionsApiResponse({
          type: "refusal",
          name: "should_respond",
        }),
      ),
    );

    const decision = await classifyShouldRespond({
      persona: "virmel",
      transcript: "",
      latestMessage: "alice: unsafe message",
      guildId: "100000000000000042",
      channelId: "100000000000000099",
      userId: "186665676134547461",
    });

    expect(decision).toBe(false);
    const span = findAdmissionSpan(exporter.getFinishedSpans());
    expect(span.attributes["classifier.refusal"]).toBe(true);
    expect(span.attributes["birmel.admission.should_respond"]).toBe(false);
    expect(await admissionOutcomeCount("refusal")).toBe(refusalBefore + 1);
  });

  test("fails closed (false) on HTTP 500 and network transport errors, recording span exceptions", async () => {
    const errorBefore = await admissionOutcomeCount("error");
    let callCount = 0;
    installTestRuntime(() => {
      callCount += 1;
      return callCount === 1
        ? Promise.resolve(
            Response.json(
              { error: { message: "upstream unavailable" } },
              { status: 500 },
            ),
          )
        : Promise.reject(new TypeError("socket hang up"));
    });

    const onHttp500 = await classifyShouldRespond({
      persona: "virmel",
      transcript: "",
      latestMessage: "alice: hello?",
      guildId: "100000000000000042",
      channelId: "100000000000000099",
      userId: "186665676134547461",
    });
    const onTransportError = await classifyShouldRespond({
      persona: "virmel",
      transcript: "",
      latestMessage: "alice: still there?",
      guildId: "100000000000000042",
      channelId: "100000000000000099",
      userId: "186665676134547461",
    });

    expect(onHttp500).toBe(false);
    expect(onTransportError).toBe(false);
    expect(await admissionOutcomeCount("error")).toBe(errorBefore + 2);

    const admissionSpans = exporter
      .getFinishedSpans()
      .filter((span) => span.name === "birmel.admission.classify");
    expect(admissionSpans).toHaveLength(2);
    for (const span of admissionSpans) {
      expect(span.attributes["birmel.admission.should_respond"]).toBe(false);
      expect(span.attributes["error.type"]).toBe("DecisionApiError");
      expect(span.events.some((event) => event.name === "exception")).toBe(
        true,
      );
    }
  });

  test("falls back cleanly to generateValidatedObject when birmel-llm-decisions-enabled is false", async () => {
    await initializeDynamicConfig({
      environment: DISABLED_FLAGS_ENV,
      config: getConfig(),
      startPolling: false,
      provider: new StaticProvider({
        "birmel-llm-decisions-enabled": false,
        "birmel-llm-classifier-model": "gpt-6-luna",
      }),
    });

    const requests = installTestRuntime(() =>
      Promise.resolve(
        responsesApiResponse({
          shouldRespond: true,
          reason: "Direct continuation of active chat",
        }),
      ),
    );

    const decision = await classifyShouldRespond({
      persona: "virmel",
      transcript: "alice: hey birmel",
      latestMessage: "alice: what do you think?",
      guildId: "100000000000000042",
      channelId: "100000000000000099",
      userId: "186665676134547461",
    });

    expect(decision).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.openai.com/v1/responses");
    const wire = ResponsesWireBodySchema.parse(requests[0]?.body);
    expect(wire.model).toBe("gpt-6-luna");
  });
});
