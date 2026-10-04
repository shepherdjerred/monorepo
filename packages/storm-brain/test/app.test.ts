import { describe, expect, test } from "vitest";
import { Registry } from "prom-client";
import { createBrainApp, type BrainAppDependencies } from "#src/app.ts";
import { BrainUpstreamError } from "#src/brain.ts";
import { ConversationBudgetError } from "#src/conversation-budget.ts";
import type { BrainConfig } from "#src/config.ts";
import { createBrainMetrics } from "#src/metrics.ts";
import type { AggregateLlmUsage } from "@shepherdjerred/llm-runtime";
import { triageRequestBody } from "./fixtures.ts";

const TOKEN = "test-bearer-token-that-is-long-enough";

const config: BrainConfig = {
  bearerToken: TOKEN,
  model: "gpt-5.6-luna",
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
        classify: async () => ({
          response: {
            offense: "spam",
            confidence: 0.9,
            label: "spam-burst",
            reasoning: "six identical lines",
            model: "gpt-5.6-luna",
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
      flags: {
        classifyEnabled: async () => true,
        triageEnabled: async () => true,
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
      model: "gpt-5.6-luna",
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

  test("reports disabled flows with 503", async () => {
    const { app, metrics } = dependencies({
      flags: {
        classifyEnabled: async () => false,
        triageEnabled: async () => false,
      },
    });
    const classify = await app.request("/v1/classify", post(classifyBody));
    expect(classify.status).toBe(503);
    const triage = await app.request("/v1/triage", post(triageBody));
    expect(triage.status).toBe(503);
    expect(
      await counter(metrics, "storm_brain_requests_total", {
        flow: "triage",
        outcome: "disabled",
      }),
    ).toBe(1);
  });

  test("charges billed usage even when the upstream call fails", async () => {
    const { app, metrics } = dependencies({
      brain: {
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
