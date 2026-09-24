import { generateText } from "ai";
import { describe, expect, test } from "vitest";
import { Registry } from "prom-client";
import { z } from "zod";
import {
  createLlmRuntime,
  generateValidatedObject,
  MAX_CORRECTIVE_PROMPT_CHARS,
  StructuredOutputExhaustionError,
  StructuredOutputTransportError,
  StructuredOutputUsageError,
  webSearchTool,
  type LlmRuntimeLogRecord,
} from "@shepherdjerred/llm-runtime";

type Fetcher = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

function usage(inputTokens = 12, outputTokens = 4) {
  return {
    input_tokens: inputTokens,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    output_tokens: outputTokens,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: inputTokens + outputTokens,
  };
}

function responsesBody(text: string, incomplete = false) {
  return {
    id: "resp_test",
    object: "response",
    model: "gpt-5.6-luna",
    status: incomplete ? "incomplete" : "completed",
    ...(incomplete
      ? { incomplete_details: { reason: "max_output_tokens" } }
      : {}),
    output: [
      {
        type: "message",
        id: "msg_test",
        role: "assistant",
        status: incomplete ? "incomplete" : "completed",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
    usage: usage(),
  };
}

function ok(text: string, incomplete = false): Response {
  return Response.json(responsesBody(text, incomplete));
}

function llmRuntime(
  fetcher: Fetcher,
  options?: {
    register?: Registry;
    logger?: (record: LlmRuntimeLogRecord) => void;
  },
) {
  return createLlmRuntime({
    credentials: {
      openai: { apiKey: "sk-test" },
      anthropic: { kind: "apiKey", apiKey: "sk-ant-test" },
      google: { project: "test-project" },
    },
    service: "runtime-test",
    appName: "Runtime Test",
    fetch: fetcher,
    ...(options?.register === undefined
      ? {}
      : { metricsRegister: options.register }),
    ...(options?.logger === undefined ? {} : { logger: options.logger }),
  });
}

const OBJECT_SCHEMA = z.object({ answer: z.string() });

function validObject(): string {
  return JSON.stringify({ answer: "yes" });
}

describe("catalog-aware routing", () => {
  test("resolves each endpoint to the provider that serves it", () => {
    const llm = llmRuntime(() => Promise.resolve(ok("x")));
    expect(llm.languageModel("gpt-5.6-luna").modelId).toBe("gpt-5.6-luna");
    expect(llm.languageModel("claude-sonnet-5").modelId).toBe(
      "claude-sonnet-5",
    );
    expect(llm.embeddingModel("text-embedding-3-small").modelId).toBe(
      "text-embedding-3-small",
    );
    expect(llm.imageModel("gemini-2.5-flash-image").modelId).toBe(
      "gemini-2.5-flash-image",
    );
  });

  test("refuses an endpoint or capability the catalog does not claim", () => {
    const llm = llmRuntime(() => Promise.resolve(ok("x")));
    expect(() => llm.languageModel("text-embedding-3-small")).toThrow(
      "not language",
    );
    expect(() => llm.imageModel("gpt-5.6-luna")).toThrow("not image");
    expect(() => llm.languageModel("gpt-9000")).toThrow("Unknown model id");
    expect(() => llm.embeddingModel("gemini-2.5-flash-image")).toThrow(
      "not embedding",
    );
  });

  test("a model routed to an unconfigured provider fails at use, not at construction", () => {
    // A service that only calls OpenAI should not have to hold Anthropic
    // configuration, so this cannot be a constructor check.
    const llm = createLlmRuntime({
      credentials: { openai: { apiKey: "sk-test" } },
      service: "openai-only",
      appName: "OpenAI Only",
      fetch: () => Promise.resolve(ok("x")),
    });
    expect(() => llm.languageModel("gpt-5.6-luna")).not.toThrow();
    expect(() => llm.languageModel("claude-sonnet-5")).toThrow(
      "no Anthropic credentials were configured",
    );
  });
});

describe("credential safety", () => {
  test("refuses to start federated while a static Anthropic key is present", () => {
    const previous = Bun.env["ANTHROPIC_API_KEY"];
    Bun.env["ANTHROPIC_API_KEY"] = "sk-ant-leftover";
    try {
      expect(() =>
        createLlmRuntime({
          credentials: {
            anthropic: {
              kind: "federation",
              identityTokenFile: "/var/run/secrets/anthropic.com/token",
              federationRuleId: "fdrl_x",
              organizationId: "org",
              serviceAccountId: "svac_x",
            },
          },
          service: "federated",
          appName: "Federated",
        }),
      ).toThrow("shadows federation");
    } finally {
      if (previous === undefined) delete Bun.env["ANTHROPIC_API_KEY"];
      else Bun.env["ANTHROPIC_API_KEY"] = previous;
    }
  });
});

describe("call options", () => {
  test("always enable body telemetry and carry the workload", () => {
    const llm = llmRuntime(() => Promise.resolve(ok("x")));
    const options = llm.callOptions({
      workload: "test.workload",
      model: "gpt-5.6-luna",
    });
    expect(options.telemetry.isEnabled).toBe(true);
    expect(options.telemetry.recordInputs).toBe(true);
    expect(options.telemetry.recordOutputs).toBe(true);
    expect(options.telemetry.functionId).toBe("test.workload");
    expect(options.include).toEqual({
      requestBody: true,
      responseBody: true,
    });
  });
});

describe("web search", () => {
  test("picks each provider's own server-side tool", () => {
    const llm = llmRuntime(() => Promise.resolve(ok("x")));
    // Provider-executed, unlike the gateway's tool, which needed a local
    // continuation shim.
    expect(webSearchTool(llm, "gpt-5.6-luna", 5)).toBeDefined();
    expect(webSearchTool(llm, "claude-sonnet-5", 5)).toBeDefined();
    expect(webSearchTool(llm, "gemini-3.8-flash", 5)).toBeDefined();
  });
});

describe("observability", () => {
  test("logs correlated accounting without prompt or response bodies", async () => {
    const records: LlmRuntimeLogRecord[] = [];
    const register = new Registry();
    const llm = llmRuntime(() => Promise.resolve(ok("hello")), {
      register,
      logger: (record) => records.push(record),
    });

    await generateText({
      model: llm.languageModel("gpt-5.6-luna"),
      prompt: "hi",
      ...llm.callOptions({ workload: "test.logging", model: "gpt-5.6-luna" }),
    });

    const record = records.find(
      (candidate) => candidate.event === "llm.provider.response",
    );
    expect(record).toMatchObject({
      outcome: "success",
      provider: "openai",
      model: "gpt-5.6-luna",
      workload: "test.logging",
      inputTokens: 12,
      outputTokens: 4,
    });
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain("hi");
    expect(serialized).not.toContain("hello");

    const metrics = await register.metrics();
    expect(metrics).toContain('provider="openai"');
    expect(metrics).toContain("llm_cost_usd_total");
  });
});

describe("generateValidatedObject", () => {
  test("returns the parsed object and charges catalog cost", async () => {
    const llm = llmRuntime(() => Promise.resolve(ok(validObject())));
    const result = await generateValidatedObject(llm, {
      model: "gpt-5.6-luna",
      schema: OBJECT_SCHEMA,
      schemaName: "answer",
      prompt: "is it?",
      workload: "test.object",
    });
    expect(result.object).toEqual({ answer: "yes" });
    expect(result.attempts).toHaveLength(1);
    expect(result.usage.catalogCostUsd).toBeGreaterThan(0);
  });

  test("repairs only semantic failures, and charges every attempt", async () => {
    let call = 0;
    const llm = llmRuntime(() => {
      call += 1;
      return Promise.resolve(
        call === 1 ? ok(JSON.stringify({ wrong: 1 })) : ok(validObject()),
      );
    });

    const result = await generateValidatedObject(llm, {
      model: "gpt-5.6-luna",
      schema: OBJECT_SCHEMA,
      schemaName: "answer",
      prompt: "is it?",
      workload: "test.repair",
    });

    expect(result.object).toEqual({ answer: "yes" });
    expect(result.attempts.map((a) => a.outcome)).toEqual([
      "semantic-error",
      "success",
    ]);
    // Both generations were billed even though only one produced an object.
    expect(result.usage.tokens.input).toBe(24);
  });

  test("uses exactly two transport retries before succeeding", async () => {
    let calls = 0;
    const llm = llmRuntime(() => {
      calls += 1;
      return calls <= 2
        ? Promise.resolve(new Response("upstream", { status: 503 }))
        : Promise.resolve(ok(validObject()));
    });

    const result = await generateValidatedObject(llm, {
      model: "gpt-5.6-luna",
      schema: OBJECT_SCHEMA,
      schemaName: "answer",
      prompt: "is it?",
      workload: "test.retry",
    });
    expect(result.object).toEqual({ answer: "yes" });
    expect(calls).toBe(3);
    // The SDK backs off between transport retries, so this outlasts the
    // default per-test timeout.
  }, 30_000);

  test("does not multiply transport retries across semantic repairs", async () => {
    // Only the first semantic attempt may retry transport failures. Otherwise
    // three semantic attempts each retrying twice is nine billable calls.
    let calls = 0;
    const llm = llmRuntime(() => {
      calls += 1;
      return calls === 1
        ? Promise.resolve(ok(JSON.stringify({ no: 1 })))
        : Promise.resolve(new Response("upstream", { status: 503 }));
    });

    await expect(
      generateValidatedObject(llm, {
        model: "gpt-5.6-luna",
        schema: OBJECT_SCHEMA,
        schemaName: "answer",
        prompt: "is it?",
        workload: "test.no-multiply",
      }),
    ).rejects.toBeInstanceOf(StructuredOutputTransportError);
    expect(calls).toBe(2);
  });

  test("a mid-retry transport failure reports the usage already charged", async () => {
    let calls = 0;
    const llm = llmRuntime(() => {
      calls += 1;
      return calls === 1
        ? Promise.resolve(ok(JSON.stringify({ no: 1 })))
        : Promise.resolve(new Response("upstream", { status: 503 }));
    });

    try {
      await generateValidatedObject(llm, {
        model: "gpt-5.6-luna",
        schema: OBJECT_SCHEMA,
        schemaName: "answer",
        prompt: "is it?",
        workload: "test.mid-transport",
      });
      expect.unreachable("expected a transport failure");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(StructuredOutputUsageError);
      // The first attempt was billed; a budget-metering caller must see it.
      expect(error).toBeInstanceOf(StructuredOutputTransportError);
      if (!(error instanceof StructuredOutputUsageError)) throw error;
      expect(error.usage.tokens.input).toBe(12);
      expect(error.attempts[0]).toMatchObject({
        attempt: 1,
        outcome: "semantic-error",
      });
      expect(error.attempts.at(-1)).toMatchObject({
        outcome: "transport-error",
      });
    }
  });

  test("a first-attempt transport failure throws raw, since nothing was billed", async () => {
    const llm = llmRuntime(() =>
      Promise.resolve(new Response("nope", { status: 401 })),
    );
    await expect(
      generateValidatedObject(llm, {
        model: "gpt-5.6-luna",
        schema: OBJECT_SCHEMA,
        schemaName: "answer",
        prompt: "is it?",
        workload: "test.first-fail",
      }),
    ).rejects.not.toBeInstanceOf(StructuredOutputUsageError);
  });

  test("exhaustion exposes every charged attempt", async () => {
    const llm = llmRuntime(() =>
      Promise.resolve(ok(JSON.stringify({ no: 1 }))),
    );
    try {
      await generateValidatedObject(llm, {
        model: "gpt-5.6-luna",
        schema: OBJECT_SCHEMA,
        schemaName: "answer",
        prompt: "is it?",
        workload: "test.exhaust",
      });
      expect.unreachable("expected exhaustion");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(StructuredOutputExhaustionError);
      if (!(error instanceof StructuredOutputUsageError)) throw error;
      expect(error.attempts).toHaveLength(3);
      expect(error.usage.tokens.input).toBe(36);
    }
  });

  test("keeps a corrective retry's added prompt within the declared bound", async () => {
    const prompts: string[] = [];
    const llm = llmRuntime((_input, init) => {
      if (typeof init?.body !== "string") {
        throw new TypeError("expected a JSON request body");
      }
      const body = z
        .object({ input: z.unknown() })
        .loose()
        .parse(JSON.parse(init.body));
      prompts.push(JSON.stringify(body.input));
      return Promise.resolve(ok(JSON.stringify({ no: 1 })));
    });

    await expect(
      generateValidatedObject(llm, {
        model: "gpt-5.6-luna",
        schema: z.object({
          answer: z.string(),
          reason: z.string(),
          score: z.number(),
        }),
        schemaName: "answer",
        prompt: "base prompt",
        workload: "test.bound",
      }),
    ).rejects.toBeInstanceOf(StructuredOutputExhaustionError);

    const first = prompts[0]?.length ?? 0;
    for (const prompt of prompts.slice(1)) {
      expect(prompt.length - first).toBeLessThanOrEqual(
        MAX_CORRECTIVE_PROMPT_CHARS,
      );
    }
  });
});
