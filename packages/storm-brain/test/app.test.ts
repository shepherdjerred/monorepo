import { describe, expect, test } from "vitest";
import { Registry } from "prom-client";
import { createBrainApp, type BrainAppDependencies } from "#src/app.ts";
import { BrainUpstreamError, createBrain } from "#src/brain.ts";
import { ConversationBudgetError } from "#src/conversation-budget.ts";
import type { BrainConfig } from "#src/config.ts";
import { createBrainMetrics } from "#src/metrics.ts";
import { ClassifyResponseSchema, OffenseSchema } from "#src/schemas.ts";
import type { AggregateLlmUsage } from "@shepherdjerred/llm-runtime";
import { CapturedDecisionWireSchema, triageRequestBody } from "./fixtures.ts";

const TOKEN = "test-bearer-token-that-is-long-enough";

const config: BrainConfig = {
  bearerToken: TOKEN,
  model: "gpt-5.6-luna",
  decisionsModel: "gpt-6-luna",
  conversationModel: "gpt-6-luna",
  maxBodyBytes: 262_144,
  llmTimeoutMs: 1000,
  metricsPort: 9090,
  port: 3000,
};

function usage(overrides: Partial<AggregateLlmUsage> = {}): AggregateLlmUsage {
  return {
    tokens: {
      input: 10,
      output: 5,
      cachedInput: 0,
      cacheWrite: 0,
      reasoning: 0,
      total: 15,
    },
    catalogCostUsd: 0.000012,
    ...overrides,
  };
}

function dependencies(overrides: Partial<BrainAppDependencies> = {}) {
  const metrics = createBrainMetrics(new Registry());
  const logged: string[] = [];
  return {
    logged,
    metrics,
    app: createBrainApp(config, {
      brain: {
        moderate: async () => ({
          response: {
            version: 1,
            decision: "allow",
            category: "none",
            confidence: 1,
            reason: "clean",
            model: "moderation-fixture",
            costMicros: 0,
            scores: {},
          },
          usage: usage({ catalogCostUsd: 0 }),
        }),
        classify: async () => ({
          response: {
            offense: "spam",
            confidence: 0.9,
            label: "spam-burst",
            reasoning: "six identical lines",
            model: "gpt-6-luna",
            costMicros: 12,
          },
          usage: usage(),
        }),
        triage: async () => ({
          response: {
            priorityId: "normal",
            confidence: 0.8,
            duplicates: [],
            evidence: "the wall is gone",
            draftReply: "looking into it",
            resolve: false,
            resolutionNote: "",
            model: "gpt-5.6-luna",
            costMicros: 12,
          },
          usage: usage(),
        }),
      },
      logger: {
        info: (message: string) => {
          logged.push(`info:${message}`);
        },
        warn: (message: string) => {
          logged.push(`warn:${message}`);
        },
        error: (message: string) => {
          logged.push(`error:${message}`);
        },
      },
      metrics,
      conversation: {
        enabled: async () => false,
        decide: async () => {
          throw new Error("conversation is not enabled in moderation fixtures");
        },
      },
      ...overrides,
    }),
  };
}

const classifyBody = {
  player: { id: "f47ac10b-58cc-4372-a567-0e02b2c3d479", name: "Alice" },
  lines: [{ text: "buy gold", at: "2017-06-01T12:00:00.000Z" }],
};

const triageBody = triageRequestBody();

function post(body: unknown, token: string | null = TOKEN) {
  return {
    method: "POST",
    headers: {
      // Null omits the header; undefined keeps the valid default.
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      "content-type": "application/json",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  } as const;
}

async function counter(
  metrics: ReturnType<typeof createBrainMetrics>,
  name: string,
  labels: Record<string, string>,
): Promise<number> {
  const scraped = await metrics.register.getMetricsAsJSON();
  const metric = scraped.find((candidate) => candidate.name === name);
  const sample = metric?.values.find(
    (value) =>
      value.labels !== undefined &&
      Object.entries(labels).every(
        ([key, expected]) => value.labels?.[key] === expected,
      ),
  );
  return typeof sample?.value === "number" ? sample.value : 0;
}

describe("storm-brain conversation", () => {
  test("conversation authenticates, rejects actions and returns only chat", async () => {
    let calls = 0;
    const body = {
      requestId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      identity: "rowan",
      personality: "Friendly builder",
      message: "Hello",
      context: "Inventory: 8 logs",
    };
    const { app } = dependencies({
      conversation: {
        enabled: async () => true,
        decide: async () => {
          calls++;
          return {
            response: {
              text: "Hello there!",
              model: "gpt-6-luna",
              costMicros: 12,
            },
            usage: usage(),
          };
        },
      },
    });
    const unauthenticated = await app.request(
      "/v1/conversation",
      post(body, null),
    );
    expect(unauthenticated.status).toBe(401);
    const invalid = await app.request(
      "/v1/conversation",
      post({ ...body, action: "mine" }),
    );
    expect(invalid.status).toBe(400);
    expect(calls).toBe(0);
    const reply = await app.request("/v1/conversation", post(body));
    expect(reply.status).toBe(200);
    expect(await reply.json()).toEqual({
      text: "Hello there!",
      model: "gpt-6-luna",
      costMicros: 12,
    });
    expect(calls).toBe(1);
  });

  test("conversation fails closed for rollout and shared budget exhaustion", async () => {
    const body = {
      requestId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      identity: "juniper",
      personality: "Farmer",
      message: "Hello",
      context: "Standing near a farm",
    };
    const disabled = dependencies();
    const disabledReply = await disabled.app.request(
      "/v1/conversation",
      post(body),
    );
    expect(disabledReply.status).toBe(503);
    const exhausted = dependencies({
      conversation: {
        enabled: async () => true,
        decide: async () => {
          throw new ConversationBudgetError("reserved limit reached");
        },
      },
    });
    const exhaustedReply = await exhausted.app.request(
      "/v1/conversation",
      post(body),
    );
    expect(exhaustedReply.status).toBe(429);
    const unavailable = dependencies({
      conversation: {
        enabled: async () => {
          throw new Error("flag provider unavailable");
        },
        decide: async () => {
          throw new Error("must never contact model");
        },
      },
    });
    const unavailableReply = await unavailable.app.request(
      "/v1/conversation",
      post(body),
    );
    expect(unavailableReply.status).toBe(500);
  });
});

describe("storm-brain app", () => {
  test("probes answer", async () => {
    const { app } = dependencies();
    const livez = await app.request("/livez");
    expect(await livez.text()).toBe("ok\n");
    const readyz = await app.request("/readyz");
    expect(await readyz.json()).toEqual({
      status: "ready",
    });
  });

  test("classify decides", async () => {
    const { app, metrics } = dependencies();
    const response = await app.request("/v1/classify", post(classifyBody));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      offense: "spam",
      confidence: 0.9,
      model: "gpt-6-luna",
      costMicros: 12,
    });
    expect(
      await counter(metrics, "storm_brain_requests_total", {
        flow: "classify",
        outcome: "success",
      }),
    ).toBe(1);
    expect(
      await counter(metrics, "storm_brain_cost_micros_total", {
        flow: "classify",
      }),
    ).toBe(12);
    expect(
      await counter(metrics, "storm_brain_tokens_total", {
        flow: "classify",
        kind: "input",
      }),
    ).toBe(10);
  });

  test("triage decides", async () => {
    const { app } = dependencies();
    const response = await app.request("/v1/triage", post(triageBody));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      priorityId: "normal",
      resolve: false,
    });
  });

  test("rejects missing and wrong bearer tokens", async () => {
    const { app } = dependencies();
    const missing = await app.request("/v1/classify", post(classifyBody, null));
    expect(missing.status).toBe(401);
    const wrong = await app.request(
      "/v1/triage",
      post(triageBody, "wrong-token-that-is-long-enough!!"),
    );
    expect(wrong.status).toBe(401);
  });

  test("rejects non-JSON bodies", async () => {
    const { app } = dependencies();
    const response = await app.request("/v1/classify", {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "text/plain",
      },
      body: "hello",
    });
    expect(response.status).toBe(415);
  });

  test("rejects oversized and malformed bodies", async () => {
    const { app } = dependencies();
    const huge = await app.request("/v1/classify", {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        "content-length": "999999999",
      },
      body: "{}",
    });
    expect(huge.status).toBe(413);

    const malformed = await app.request("/v1/classify", post("{nope"));
    expect(malformed.status).toBe(400);

    const wrongShape = await app.request(
      "/v1/classify",
      post({ player: { id: "x", name: "Alice" } }),
    );
    expect(wrongShape.status).toBe(400);

    const unknownKeys = await app.request(
      "/v1/classify",
      post({ ...classifyBody, bogus: 1 }),
    );
    expect(unknownKeys.status).toBe(400);
  });

  test("charges billed usage even when the upstream call fails", async () => {
    const { app, metrics } = dependencies({
      brain: {
        moderate: async () => {
          throw new BrainUpstreamError("unreachable", undefined);
        },
        classify: async () => {
          throw new BrainUpstreamError("timeout", usage());
        },
        triage: async () => {
          throw new BrainUpstreamError("unreachable", undefined);
        },
      },
    });
    const billed = await app.request("/v1/classify", post(classifyBody));
    expect(billed.status).toBe(502);
    expect(
      await counter(metrics, "storm_brain_cost_micros_total", {
        flow: "classify",
      }),
    ).toBe(12);

    const unbilled = await app.request("/v1/triage", post(triageBody));
    expect(unbilled.status).toBe(502);
    expect(
      await counter(metrics, "storm_brain_cost_micros_total", {
        flow: "triage",
      }),
    ).toBe(0);
  });

  test("maps unexpected failures to 500", async () => {
    const { app, metrics } = dependencies({
      brain: {
        moderate: async () => {
          throw new Error("boom");
        },
        classify: async () => {
          throw new Error("boom");
        },
        triage: async () => {
          throw new Error("boom");
        },
      },
    });
    const response = await app.request("/v1/classify", post(classifyBody));
    expect(response.status).toBe(500);
    expect(
      await counter(metrics, "storm_brain_requests_total", {
        flow: "classify",
        outcome: "error",
      }),
    ).toBe(1);
  });
});

describe("storm-brain classify decisions", () => {
  test("live createBrain /v1/classify uses runtime.decide() on gpt-6-luna for clean, offense, refusal, and HTTP error responses", async () => {
    const calls: { url: string; body: unknown }[] = [];
    let mode: "none" | "advertising" | "refusal" | "http_error" = "none";

    const brain = createBrain({
      model: "gpt-6-luna",
      decisionsModel: "gpt-6-luna",
      timeoutMs: 5000,
      credentials: { openai: { apiKey: "test-openai-key" } },
      fetcher: async (url, init) => {
        calls.push({
          url,
          body: JSON.parse(typeof init.body === "string" ? init.body : "{}"),
        });
        if (mode === "http_error") {
          return Response.json(
            { error: { message: "upstream unavailable" } },
            { status: 503 },
          );
        }
        return Response.json({
          id: "dec_cls_1",
          model: "gpt-6-luna",
          answers:
            mode === "refusal"
              ? [{ type: "refusal", name: "offense" }]
              : mode === "none"
                ? [
                    {
                      type: "choice",
                      name: "offense",
                      choice: "none",
                      confidence: 0.92,
                      probabilities: [
                        { value: "none", probability: 0.92 },
                        { value: "advertising", probability: 0.08 },
                      ],
                    },
                  ]
                : [
                    {
                      type: "choice",
                      name: "offense",
                      choice: "advertising",
                      confidence: 0.88,
                      probabilities: [
                        { value: "advertising", probability: 0.88 },
                        { value: "none", probability: 0.12 },
                      ],
                    },
                  ],
          usage: {
            input_tokens: 30_000,
            input_tokens_details: { cached_tokens: 10_000 },
            output_tokens: 0,
            total_tokens: 30_000,
          },
        });
      },
    });

    const { app, metrics } = dependencies({ brain });

    const cleanResponse = await app.request(
      "/v1/classify",
      post({
        player: { id: "f47ac10b-58cc-4372-a567-0e02b2c3d479", name: "Alice" },
        lines: [
          { text: "found an unlocked chest!", at: "2017-06-01T12:00:00.000Z" },
        ],
      }),
    );
    expect(cleanResponse.status).toBe(200);
    const cleanPayload = ClassifyResponseSchema.parse(
      await cleanResponse.json(),
    );
    expect(cleanPayload.offense).toBeNull();
    expect(cleanPayload.confidence).toBeCloseTo(0.08, 6);
    expect(cleanPayload.label).toBe("clean");
    expect(cleanPayload.reasoning).toBe("No actionable chat offense detected.");
    expect(cleanPayload.model).toBe("gpt-6-luna");
    expect(cleanPayload.costMicros).toBe(2100);

    expect(calls[0]?.url).toBe("https://api.openai.com/v1/decisions");
    const wire = CapturedDecisionWireSchema.parse(calls[0]?.body);
    expect(wire.model).toBe("gpt-6-luna");
    expect(wire.prompt_cache_key).toBe("storm-brain:classify:v1");
    expect(wire.system[0]?.prompt_cache_breakpoint).toBe(true);
    expect(String(wire.input)).toContain("Alice");
    expect(wire.questions).toHaveLength(1);
    expect(wire.questions[0]?.name).toBe("offense");
    expect(wire.questions[0]?.choices.map((choice) => choice.value)).toEqual([
      "none",
      ...OffenseSchema.options,
    ]);

    mode = "advertising";
    const offenseResponse = await app.request(
      "/v1/classify",
      post(classifyBody),
    );
    expect(offenseResponse.status).toBe(200);
    const offensePayload = ClassifyResponseSchema.parse(
      await offenseResponse.json(),
    );
    expect(offensePayload).toEqual({
      offense: "advertising",
      confidence: 0.88,
      label: "advertising",
      reasoning:
        "External server promotion or real-money trading solicitation detected.",
      model: "gpt-6-luna",
      costMicros: 2100,
    });

    mode = "refusal";
    const refusalResponse = await app.request(
      "/v1/classify",
      post(classifyBody),
    );
    expect(refusalResponse.status).toBe(200);
    const refusalPayload = ClassifyResponseSchema.parse(
      await refusalResponse.json(),
    );
    expect(refusalPayload).toEqual({
      offense: "spam",
      confidence: 0.5,
      label: "refusal-review",
      reasoning:
        "Classifier declined; below auto-action threshold for staff awareness.",
      model: "gpt-6-luna",
      costMicros: 2100,
    });

    expect(
      await counter(metrics, "storm_brain_tokens_total", {
        flow: "classify",
        kind: "output",
      }),
    ).toBe(0);

    mode = "http_error";
    const errorResponse = await app.request("/v1/classify", post(classifyBody));
    expect(errorResponse.status).toBe(502);
  });
});
