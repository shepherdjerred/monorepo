import { generateText } from "ai";
import { describe, expect, test } from "vitest";
import { getPricing } from "@shepherdjerred/llm-models";
import { Registry } from "prom-client";
import { z } from "zod";
import {
  createOpenRouterRuntime,
  generateValidatedObject,
  MAX_CORRECTIVE_PROMPT_CHARS,
  openRouterWebSearchTool,
  StructuredOutputUsageError,
  parseOpenRouterMetadata,
  StructuredOutputExhaustionError,
  StructuredOutputTransportError,
  type OpenRouterRuntimeLogRecord,
} from "@shepherdjerred/llm-runtime";
import { executeWebSearchContinuation } from "#src/openrouter-tools.ts";

const RequestBodySchema = z
  .object({
    model: z.string(),
    provider: z
      .object({
        allow_fallbacks: z.boolean(),
        data_collection: z.string(),
        require_parameters: z.boolean(),
      })
      .loose(),
    response_format: z.object({ type: z.string() }).loose().optional(),
    max_tokens: z.number().int().positive().optional(),
    seed: z.number().int().optional(),
    reasoning: z.object({ effort: z.string() }).optional(),
    session_id: z.string().optional(),
    trace: z.record(z.string(), z.string()),
  })
  .loose();

function openRouterResponse(
  content: string,
  finishReason: "stop" | "length" = "stop",
): Response {
  return Response.json({
    id: "gen-test",
    model: "openai/gpt-5.6-luna",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: 12,
      completion_tokens: 4,
      total_tokens: 16,
      cost: 0.0001,
      cost_details: { upstream_inference_cost: 0.00008 },
    },
    openrouter_metadata: {
      requested: "openai/gpt-5.6-luna",
      strategy: "direct",
      region: "iad",
      attempt: 2,
      attempts: [
        {
          provider: "Provider A",
          model: "openai/gpt-5.6-luna",
          status: 503,
        },
        {
          provider: "Provider B",
          model: "openai/gpt-5.6-luna",
          status: 200,
        },
      ],
    },
  });
}

describe("catalog-aware runtime", () => {
  test("resolves exact endpoint and capability contracts", () => {
    const runtime = createOpenRouterRuntime({
      apiKey: "test-key",
      service: "test",
      appName: "test",
    });
    expect(runtime.languageModel("gpt-5.6-luna").modelId).toBe(
      "openai/gpt-5.6-luna",
    );
    expect(runtime.embeddingModel("text-embedding-3-small").modelId).toBe(
      "openai/text-embedding-3-small",
    );
    expect(runtime.imageModel("gemini-2.5-flash-image").modelId).toBe(
      "google/gemini-2.5-flash-image",
    );
    expect(() => runtime.embeddingModel("gpt-5.6-luna")).toThrow(
      "uses OpenRouter language, not embedding",
    );
    expect(() =>
      runtime.languageModel("text-embedding-3-small", ["tools"]),
    ).toThrow("uses OpenRouter embedding, not language");
  });

  test("call options always enable body telemetry and correlation", () => {
    const runtime = createOpenRouterRuntime({
      apiKey: "test-key",
      service: "test",
      appName: "test",
    });
    const options = runtime.callOptions({
      workload: "unit-test",
      sessionId: "session-1",
      traceContext: {
        traceId: "0123456789abcdef0123456789abcdef",
        parentSpanId: "0123456789abcdef",
      },
    });
    expect(options.telemetry.isEnabled).toBe(true);
    expect(options.telemetry.recordInputs).toBe(true);
    expect(options.telemetry.recordOutputs).toBe(true);
    expect(options.include).toEqual({ requestBody: true, responseBody: true });
    expect(options.headers["x-session-id"]).toBe("session-1");
    expect(options.headers["x-sjerred-llm-workload"]).toBe("unit-test");
    expect(options.headers["x-sjerred-llm-trace-id"]).toBe(
      "0123456789abcdef0123456789abcdef",
    );
  });

  test("maps the provider-defined web-search tool with a bounded result count", async () => {
    let requestBody: unknown;
    const runtime = createOpenRouterRuntime({
      apiKey: "test-key",
      service: "test",
      appName: "test",
      fetch: async (_input, init) => {
        if (typeof init?.body !== "string") {
          throw new TypeError("expected JSON request body");
        }
        requestBody = JSON.parse(init.body);
        return openRouterResponse("Research evidence");
      },
    });
    await generateText({
      model: runtime.languageModel("claude-sonnet-5", ["tools", "webSearch"]),
      prompt: "Research an unfamiliar merchant.",
      tools: { web_search: openRouterWebSearchTool(runtime, 3) },
      ...runtime.callOptions({ workload: "web-search-unit-test" }),
    });
    expect(
      z
        .object({
          tools: z.array(
            z.object({
              type: z.literal("openrouter:web_search"),
              max_results: z.literal(3),
            }),
          ),
        })
        .loose()
        .parse(requestBody).tools,
    ).toEqual([{ type: "openrouter:web_search", max_results: 3 }]);
  });

  test("web-search local continuation without provider results fails loudly", () => {
    // Server-supplied results pass through untouched, including a genuine
    // empty result set; an absent results field means the provider never
    // executed the search and must not be silently coerced to "no evidence".
    expect(
      executeWebSearchContinuation({
        results: [{ url: "https://example.com" }],
      }),
    ).toEqual([{ url: "https://example.com" }]);
    expect(executeWebSearchContinuation({ results: [] })).toEqual([]);
    expect(() => executeWebSearchContinuation({})).toThrow(
      "without server-supplied results",
    );
  });

  test("logs correlated accounting metadata without request or response bodies", async () => {
    const records: OpenRouterRuntimeLogRecord[] = [];
    const runtime = createOpenRouterRuntime({
      apiKey: "super-secret-key",
      service: "test",
      appName: "test",
      logger: (record) => records.push(record),
      fetch: () => Promise.resolve(openRouterResponse("sensitive output")),
    });

    await generateText({
      model: runtime.languageModel("gpt-5.6-luna"),
      prompt: "sensitive prompt",
      ...runtime.callOptions({
        workload: "logging-unit-test",
        traceContext: {
          traceId: "0123456789abcdef0123456789abcdef",
        },
      }),
    });
    for (let attempt = 0; records.length === 0 && attempt < 20; attempt += 1) {
      await Bun.sleep(1);
    }

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      event: "llm.openrouter.response",
      model: "gpt-5.6-luna",
      resolvedModel: "openai/gpt-5.6-luna",
      upstreamProvider: "Provider B",
      generationId: "gen-test",
      fallbackAttempts: 1,
      inputTokens: 12,
      outputTokens: 4,
      actualCostUsd: 0.0001,
      traceId: "0123456789abcdef0123456789abcdef",
      outcome: "success",
    });
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain("sensitive prompt");
    expect(serialized).not.toContain("sensitive output");
    expect(serialized).not.toContain("super-secret-key");
  });
});

describe("OpenRouter metadata", () => {
  test("decodes additive router and accounting fields", () => {
    const metadata = parseOpenRouterMetadata({
      requestedModel: "gpt-5.6-luna",
      responseId: "gen-test",
      resolvedModel: "openai/gpt-5.6-luna",
      usage: {
        inputTokens: 12,
        inputTokenDetails: {
          noCacheTokens: 10,
          cacheReadTokens: 2,
          cacheWriteTokens: undefined,
        },
        outputTokens: 4,
        outputTokenDetails: { textTokens: 3, reasoningTokens: 1 },
        totalTokens: 16,
      },
      providerMetadata: {
        openrouter: {
          provider: "Provider B",
          usage: {
            cost: 0.0001,
            costDetails: { upstreamInferenceCost: 0.00008 },
          },
          futureField: "ignored",
        },
      },
      responseBody: {
        id: "gen-test",
        model: "openai/gpt-5.6-luna",
        openrouter_metadata: {
          requested: "openai/gpt-5.6-luna",
          strategy: "direct",
          region: "iad",
          attempt: 2,
          attempts: [
            {
              provider: "Provider A",
              model: "openai/gpt-5.6-luna",
              status: 503,
            },
            {
              provider: "Provider B",
              model: "openai/gpt-5.6-luna",
              status: 200,
            },
          ],
          futureField: { accepted: true },
        },
      },
    });
    expect(metadata.fallbackAttempts).toBe(1);
    expect(metadata.upstreamProvider).toBe("Provider B");
    expect(metadata.region).toBe("iad");
    expect(metadata.actualCostUsd).toBe(0.0001);
    expect(metadata.upstreamCostUsd).toBe(0.00008);
    expect(metadata.routerMetadataPresent).toBe(true);
  });

  test("uses raw OpenRouter token details when AI SDK usage is unavailable", () => {
    const metadata = parseOpenRouterMetadata({
      requestedModel: "gpt-5.6-luna",
      responseBody: {
        usage: {
          prompt_tokens: 20,
          completion_tokens: 7,
          total_tokens: 27,
          prompt_tokens_details: { cached_tokens: 5 },
          completion_tokens_details: { reasoning_tokens: 3 },
        },
      },
    });

    expect(metadata.tokens).toEqual({
      input: 20,
      output: 7,
      cachedInput: 5,
      cacheWrite: 0,
      reasoning: 3,
      total: 27,
    });
    expect(metadata.catalogCostUsd).toBeDefined();
  });

  test("prices Anthropic cache reads and writes with their catalog rates", () => {
    // claude-sonnet-5: input 3, output 15, cacheRead 0.3, cacheWrite 3.75 per 1M.
    const metadata = parseOpenRouterMetadata({
      requestedModel: "claude-sonnet-5",
      responseBody: {
        usage: {
          prompt_tokens: 1_000_000,
          completion_tokens: 0,
          total_tokens: 1_000_000,
          prompt_tokens_details: {
            cached_tokens: 800_000,
            cache_write_tokens: 100_000,
          },
        },
      },
    });

    expect(metadata.tokens.cachedInput).toBe(800_000);
    expect(metadata.tokens.cacheWrite).toBe(100_000);
    // 200k uncached @ $3 + 800k cache-read @ $0.30 + 100k cache-write @ $3.75.
    expect(metadata.catalogCostUsd).toBeCloseTo(0.6 + 0.24 + 0.375, 10);
  });

  test("prices OpenAI cached input as a subset of the inclusive prompt count", () => {
    // gpt-5.4-nano declares `cachedInput`, so cache reads stay inside `input`.
    const metadata = parseOpenRouterMetadata({
      requestedModel: "gpt-5.4-nano",
      responseBody: {
        usage: {
          prompt_tokens: 1_000_000,
          completion_tokens: 0,
          total_tokens: 1_000_000,
          prompt_tokens_details: { cached_tokens: 800_000 },
        },
      },
    });

    const pricing = getPricing("gpt-5.4-nano");
    if (pricing?.modality !== "text" || pricing.cachedInput === undefined) {
      throw new Error("gpt-5.4-nano must declare OpenAI cached-input pricing");
    }
    expect(metadata.catalogCostUsd).toBeCloseTo(
      (200_000 * pricing.input + 800_000 * pricing.cachedInput) / 1_000_000,
      10,
    );
  });

  test("infers fallback count from additive attempts when attempt is absent", () => {
    const metadata = parseOpenRouterMetadata({
      requestedModel: "gpt-5.6-luna",
      responseBody: {
        openrouter_metadata: {
          attempts: [
            {
              provider: "Provider A",
              model: "openai/gpt-5.6-luna",
              status: 503,
            },
            {
              provider: "Provider B",
              model: "openai/gpt-5.6-luna",
              status: 200,
            },
          ],
        },
      },
    });

    expect(metadata.fallbackAttempts).toBe(1);
    expect(metadata.upstreamProvider).toBe("Provider B");
  });
});

describe("generateValidatedObject", () => {
  test("uses strict OpenRouter routing and repairs only semantic output", async () => {
    const bodies: z.infer<typeof RequestBodySchema>[] = [];
    const logRecords: OpenRouterRuntimeLogRecord[] = [];
    const responses = [
      openRouterResponse('{"count":"bad"}'),
      openRouterResponse('{"count":2}'),
    ];
    const runtime = createOpenRouterRuntime({
      apiKey: "test-key",
      service: "test",
      appName: "test",
      metricsRegister: new Registry(),
      logger: (record) => logRecords.push(record),
      fetch: Object.assign(
        async (
          _input: Parameters<typeof fetch>[0],
          init?: Parameters<typeof fetch>[1],
        ) => {
          if (typeof init?.body !== "string") {
            throw new TypeError("expected JSON request body");
          }
          bodies.push(RequestBodySchema.parse(JSON.parse(init.body)));
          const response = responses.shift();
          if (response === undefined) throw new Error("unexpected request");
          return response;
        },
        { preconnect: (url: string | URL) => void url },
      ),
    });

    const result = await generateValidatedObject(runtime, {
      model: "gpt-5.6-luna",
      schema: z.object({ count: z.number().int() }),
      schemaName: "CountResult",
      prompt: "Return a count.",
      workload: "structured-unit-test",
      sessionId: "session-1",
    });

    expect(result.object).toEqual({ count: 2 });
    expect(result.attempts.map((attempt) => attempt.outcome)).toEqual([
      "semantic-error",
      "success",
    ]);
    expect(result.metadata).toHaveLength(2);
    expect(result.attempts[0]?.metadata?.generationId).toBe("gen-test");
    expect(result.usage.tokens.total).toBe(32);
    expect(result.usage.actualCostUsd).toBe(0.0002);
    expect(result.usage.catalogCostUsd).toBeCloseTo(0.000072);
    expect(result.usage.upstreamCostUsd).toBe(0.00016);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.model).toBe("openai/gpt-5.6-luna");
    expect(bodies[0]?.provider).toEqual({
      allow_fallbacks: true,
      data_collection: "deny",
      require_parameters: true,
    });
    expect(bodies[0]?.response_format?.type).toBe("json_schema");
    expect(bodies[0]?.session_id).toBe("session-1");
    expect(
      logRecords.some(
        (record) => record.event === "llm.openrouter.call_failed",
      ),
    ).toBe(false);
  });

  test("fails authentication immediately without semantic replay", async () => {
    let requestCount = 0;
    const runtime = createOpenRouterRuntime({
      apiKey: "bad-key",
      service: "test",
      appName: "test",
      fetch: Object.assign(
        () => {
          requestCount += 1;
          return Promise.resolve(
            Response.json(
              { error: { code: 401, message: "invalid key" } },
              { status: 401 },
            ),
          );
        },
        { preconnect: (url: string | URL) => void url },
      ),
    });

    await expect(
      generateValidatedObject(runtime, {
        model: "gpt-5.6-luna",
        schema: z.object({ count: z.number() }),
        schemaName: "CountResult",
        prompt: "Return a count.",
        workload: "auth-test",
      }),
    ).rejects.toThrow();
    expect(requestCount).toBe(1);
  });
});

describe("generateValidatedObject retries", () => {
  test("uses exactly two transport retries before succeeding", async () => {
    let requestCount = 0;
    const runtime = createOpenRouterRuntime({
      apiKey: "test-key",
      service: "test",
      appName: "test",
      fetch: (_input, _init) => {
        requestCount += 1;
        if (requestCount < 3) {
          return Promise.resolve(
            Response.json(
              { error: { code: 503, message: "provider unavailable" } },
              { status: 503, headers: { "Retry-After": "0" } },
            ),
          );
        }
        return Promise.resolve(openRouterResponse('{"count":3}'));
      },
    });

    const result = await generateValidatedObject(runtime, {
      model: "gpt-5.6-luna",
      schema: z.object({ count: z.number().int() }),
      schemaName: "CountResult",
      prompt: "Return a count.",
      workload: "transport-retry-test",
    });

    expect(result.object).toEqual({ count: 3 });
    expect(result.attempts).toHaveLength(1);
    expect(requestCount).toBe(3);
  });

  test("does not multiply transport retries across semantic repairs", async () => {
    let requestCount = 0;
    const runtime = createOpenRouterRuntime({
      apiKey: "test-key",
      service: "test",
      appName: "test",
      fetch: () => {
        requestCount += 1;
        if (requestCount === 1) {
          return Promise.resolve(openRouterResponse('{"count":"bad"}'));
        }
        return Promise.resolve(
          Response.json(
            { error: { code: 503, message: "provider unavailable" } },
            { status: 503, headers: { "Retry-After": "0" } },
          ),
        );
      },
    });

    await expect(
      generateValidatedObject(runtime, {
        model: "gpt-5.6-luna",
        schema: z.object({ count: z.number().int() }),
        schemaName: "CountResult",
        prompt: "Return a count.",
        workload: "bounded-retry-test",
      }),
    ).rejects.toThrow();
    expect(requestCount).toBe(2);
  });
});

describe("generateValidatedObject transport failures", () => {
  test("wraps a mid-retry transport failure with the usage already charged", async () => {
    let requestCount = 0;
    const runtime = createOpenRouterRuntime({
      apiKey: "test-key",
      service: "test",
      appName: "test",
      fetch: () => {
        requestCount += 1;
        if (requestCount === 1) {
          return Promise.resolve(openRouterResponse('{"count":"bad"}'));
        }
        return Promise.resolve(
          Response.json(
            { error: { code: 503, message: "provider unavailable" } },
            { status: 503, headers: { "Retry-After": "0" } },
          ),
        );
      },
    });
    let thrown: unknown;

    try {
      await generateValidatedObject(runtime, {
        model: "gpt-5.6-luna",
        schema: z.object({ count: z.number().int() }),
        schemaName: "CountResult",
        prompt: "Return a count.",
        workload: "transport-after-semantic-test",
      });
    } catch (error: unknown) {
      thrown = error;
    }

    // The first attempt billed a semantic failure; the 503 on the corrective
    // attempt must not discard that spend from budget-metering callers.
    expect(thrown).toBeInstanceOf(StructuredOutputTransportError);
    if (!(thrown instanceof StructuredOutputTransportError)) {
      throw new Error("expected structured-output transport error");
    }
    expect(thrown instanceof StructuredOutputUsageError).toBe(true);
    expect(thrown.attempts.map((attempt) => attempt.outcome)).toEqual([
      "semantic-error",
      "transport-error",
    ]);
    expect(thrown.usage.tokens.total).toBe(16);
    expect(thrown.cause).toBeDefined();
  });

  test("wraps an immediate API failure that follows a billable attempt", async () => {
    let requestCount = 0;
    const runtime = createOpenRouterRuntime({
      apiKey: "test-key",
      service: "test",
      appName: "test",
      fetch: () => {
        requestCount += 1;
        if (requestCount === 1) {
          return Promise.resolve(openRouterResponse('{"count":"bad"}'));
        }
        return Promise.resolve(
          Response.json(
            { error: { code: 402, message: "insufficient credits" } },
            { status: 402 },
          ),
        );
      },
    });
    let thrown: unknown;

    try {
      await generateValidatedObject(runtime, {
        model: "gpt-5.6-luna",
        schema: z.object({ count: z.number().int() }),
        schemaName: "CountResult",
        prompt: "Return a count.",
        workload: "immediate-after-semantic-test",
      });
    } catch (error: unknown) {
      thrown = error;
    }

    // A 402 right after the first billable call drained the balance is the
    // exact moment budget metering must still see that first attempt's spend.
    expect(thrown).toBeInstanceOf(StructuredOutputTransportError);
    if (!(thrown instanceof StructuredOutputTransportError)) {
      throw new Error("expected structured-output transport error");
    }
    expect(thrown.usage.tokens.total).toBe(16);
    expect(thrown.cause).toBeDefined();
  });

  test("first-attempt transport failures still throw the raw error", async () => {
    const runtime = createOpenRouterRuntime({
      apiKey: "test-key",
      service: "test",
      appName: "test",
      fetch: () =>
        Promise.resolve(
          Response.json(
            { error: { code: 503, message: "provider unavailable" } },
            { status: 503, headers: { "Retry-After": "0" } },
          ),
        ),
    });

    // No billable prior attempt exists, so callers keep the untouched
    // transport error their retry classification already understands.
    let thrown: unknown;
    try {
      await generateValidatedObject(runtime, {
        model: "gpt-5.6-luna",
        schema: z.object({ count: z.number().int() }),
        schemaName: "CountResult",
        prompt: "Return a count.",
        workload: "transport-first-attempt-test",
      });
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    expect(thrown instanceof StructuredOutputTransportError).toBe(false);
  });
});

describe("generateValidatedObject exhaustion", () => {
  test("throws typed exhaustion with every charged semantic attempt", async () => {
    const runtime = createOpenRouterRuntime({
      apiKey: "test-key",
      service: "test",
      appName: "test",
      fetch: () => Promise.resolve(openRouterResponse('{"count":"still bad"}')),
    });
    let thrown: unknown;

    try {
      await generateValidatedObject(runtime, {
        model: "gpt-5.6-luna",
        schema: z.object({ count: z.number().int() }),
        schemaName: "CountResult",
        prompt: "Return a count.",
        workload: "exhaustion-test",
      });
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(StructuredOutputExhaustionError);
    if (!(thrown instanceof StructuredOutputExhaustionError)) {
      throw new Error("expected structured-output exhaustion");
    }
    expect(thrown.attempts).toHaveLength(3);
    expect(
      thrown.attempts.every(
        (attempt) =>
          attempt.outcome === "semantic-error" &&
          attempt.metadata?.generationId === "gen-test",
      ),
    ).toBe(true);
    expect(thrown.usage.tokens.total).toBe(48);
    expect(thrown.usage.actualCostUsd).toBeCloseTo(0.0003);
    expect(thrown.usage.catalogCostUsd).toBeCloseTo(0.000108);
    expect(thrown.usage.upstreamCostUsd).toBeCloseTo(0.00024);
  });

  test("raises a truncated retry cap without multiplying semantic attempts", async () => {
    const bodies: z.infer<typeof RequestBodySchema>[] = [];
    const responses = [
      openRouterResponse('{"count":', "length"),
      openRouterResponse('{"count":2}'),
    ];
    const runtime = createOpenRouterRuntime({
      apiKey: "test-key",
      service: "test",
      appName: "test",
      fetch: Object.assign(
        async (
          _input: Parameters<typeof fetch>[0],
          init?: Parameters<typeof fetch>[1],
        ) => {
          if (typeof init?.body !== "string") {
            throw new TypeError("expected JSON request body");
          }
          bodies.push(RequestBodySchema.parse(JSON.parse(init.body)));
          const response = responses.shift();
          if (response === undefined) throw new Error("unexpected request");
          return response;
        },
        { preconnect: (url: string | URL) => void url },
      ),
    });

    const result = await generateValidatedObject(runtime, {
      model: "gpt-5.6-luna",
      schema: z.object({ count: z.number().int() }),
      schemaName: "CountResult",
      prompt: "Return a count.",
      workload: "truncation-unit-test",
      maxOutputTokens: 100,
      semanticRetryMaxOutputTokens: 200,
      reasoningEffort: "medium",
      seed: 7,
    });

    expect(result.object).toEqual({ count: 2 });
    expect(bodies.map((body) => body.max_tokens)).toEqual([100, 200]);
    expect(bodies.map((body) => body.seed)).toEqual([7, 7]);
    expect(bodies.map((body) => body.reasoning?.effort)).toEqual([
      "medium",
      "medium",
    ]);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]?.finishReason).toBe("length");
  });
});

describe("generateValidatedObject corrective prompts", () => {
  test("keeps a semantic retry's added prompt within the declared bound", async () => {
    const PromptBodySchema = z
      .object({
        messages: z.array(
          z.object({ role: z.string(), content: z.string() }).loose(),
        ),
      })
      .loose();
    const prompts: string[] = [];
    const responses = [
      openRouterResponse('{"count":1}'),
      openRouterResponse('{"count":2}'),
    ];
    const runtime = createOpenRouterRuntime({
      apiKey: "test-key",
      service: "test",
      appName: "test",
      fetch: Object.assign(
        async (
          _input: Parameters<typeof fetch>[0],
          init?: Parameters<typeof fetch>[1],
        ) => {
          if (typeof init?.body !== "string") {
            throw new TypeError("expected JSON request body");
          }
          const body = PromptBodySchema.parse(JSON.parse(init.body));
          const user = body.messages.findLast(
            (message) => message.role === "user",
          );
          if (user === undefined) throw new Error("expected a user message");
          prompts.push(user.content);
          const response = responses.shift();
          if (response === undefined) throw new Error("unexpected request");
          return response;
        },
        { preconnect: (url: string | URL) => void url },
      ),
    });

    // A validation message far larger than the bound forces the truncation path.
    const result = await generateValidatedObject(runtime, {
      model: "gpt-5.6-luna",
      schema: z
        .object({ count: z.number().int() })
        .refine((value) => value.count > 1, { message: "z".repeat(20_000) }),
      schemaName: "CountResult",
      prompt: "Return a count.",
      workload: "corrective-prompt-bound-test",
    });

    expect(result.object).toEqual({ count: 2 });
    expect(prompts).toHaveLength(2);
    const [first, retry] = prompts;
    if (first === undefined || retry === undefined) {
      throw new Error("expected two recorded prompts");
    }
    const added = retry.length - first.length;
    // Truncation engaged (otherwise the 20k message would flow through), and
    // the result still respects the bound budget callers reserve against.
    expect(added).toBeGreaterThan(MAX_CORRECTIVE_PROMPT_CHARS / 2);
    expect(added).toBeLessThanOrEqual(MAX_CORRECTIVE_PROMPT_CHARS);
  });
});
