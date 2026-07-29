import { describe, expect, test } from "bun:test";
import { z } from "zod/v4";
import { ApplicationFailure } from "@temporalio/common";
import {
  generationArtifactKey,
  generationRequestSha256,
  readOrCreateGenerationArtifact,
  type GenerationArtifactStore,
} from "./glitter-context-refresh-cache.ts";
import { GenerationBudget } from "./glitter-context-refresh-budget.ts";
import {
  glitterCompletionArtifactSchema,
  useGlitterCompletionArtifact,
} from "./glitter-context-refresh-openai.ts";

const ResponseSchema = z.strictObject({ value: z.string() });
const UnknownResponseSchema: z.ZodType = ResponseSchema;

function memoryStore(): {
  store: GenerationArtifactStore;
  values: Map<string, unknown>;
} {
  const values = new Map<string, unknown>();
  return {
    values,
    store: {
      read: async (key) => values.get(key),
      create: async (key, value) => {
        if (!values.has(key)) {
          values.set(key, value);
        }
      },
    },
  };
}

describe("Glitter context generation artifacts", () => {
  test("reuses the first schema-validated response for an identical request", async () => {
    const { store, values } = memoryStore();
    let generationCount = 0;
    const run = async (value: string) =>
      await readOrCreateGenerationArtifact({
        store,
        model: "test-model",
        callSite: "style-card",
        request: { prompt: "stable prompt", seed: 0 },
        responseSchema: ResponseSchema,
        generate: async () => {
          generationCount += 1;
          return {
            response: { value },
            usage: {
              inputTokens: 10,
              outputTokens: 2,
              cachedInputTokens: 0,
              costUsd: 0.01,
            },
          };
        },
      });

    const first = await run("first");
    const reused = await run("different");
    expect(first.response).toEqual({ value: "first" });
    expect(first.cacheStatus).toBe("miss");
    expect(reused.response).toEqual({ value: "first" });
    expect(reused.cacheStatus).toBe("hit");
    expect(generationCount).toBe(1);
    expect(values.size).toBe(1);
  });

  test("uses the atomic first-writer result after a create race", async () => {
    const winner = memoryStore();
    const store: GenerationArtifactStore = {
      read: winner.store.read,
      create: async (key) => {
        await winner.store.create(key, {
          schemaVersion: 2,
          model: "test-model",
          callSite: "style-card",
          requestSha256: generationRequestSha256({ prompt: "same" }),
          responseSha256: generationRequestSha256({ value: "winner" }),
          response: { value: "winner" },
          usage: {
            inputTokens: 10,
            outputTokens: 2,
            cachedInputTokens: 0,
            costUsd: 0.01,
          },
        });
      },
    };

    const result = await readOrCreateGenerationArtifact({
      store,
      model: "test-model",
      callSite: "style-card",
      request: { prompt: "same" },
      responseSchema: ResponseSchema,
      generate: async () => ({
        response: { value: "loser" },
        usage: {
          inputTokens: 10,
          outputTokens: 2,
          cachedInputTokens: 0,
          costUsd: 0.01,
        },
      }),
    });

    expect(result.response).toEqual({ value: "winner" });
    expect(result.cacheStatus).toBe("miss");
  });

  test("fails closed when a stored response checksum is corrupt", async () => {
    const request = { prompt: "stable prompt" };
    const requestSha256 = generationRequestSha256(request);
    const values = new Map<string, unknown>([
      [
        generationArtifactKey({
          callSite: "style-card",
          requestSha256,
        }),
        {
          schemaVersion: 2,
          model: "test-model",
          callSite: "style-card",
          requestSha256,
          responseSha256: "0".repeat(64),
          response: { value: "corrupt" },
          usage: {
            inputTokens: 10,
            outputTokens: 2,
            cachedInputTokens: 0,
            costUsd: 0.01,
          },
        },
      ],
    ]);
    const store: GenerationArtifactStore = {
      read: async (key) => values.get(key),
      create: async () => {
        throw new Error("create must not run for an existing artifact");
      },
    };

    await expect(
      readOrCreateGenerationArtifact({
        store,
        model: "test-model",
        callSite: "style-card",
        request,
        responseSchema: ResponseSchema,
        generate: async () => ({
          response: { value: "unused" },
          usage: {
            inputTokens: 10,
            outputTokens: 2,
            cachedInputTokens: 0,
            costUsd: 0.01,
          },
        }),
      }),
    ).rejects.toThrow("response checksum mismatch");
  });

  test("fails non-retryably after a billed schema-invalid response", async () => {
    let createCount = 0;
    const store: GenerationArtifactStore = {
      read: () => Promise.resolve(),
      create: async () => {
        createCount += 1;
      },
    };

    let failure: unknown;
    try {
      await readOrCreateGenerationArtifact({
        store,
        model: "test-model",
        callSite: "style-card",
        request: { prompt: "stable prompt" },
        responseSchema: UnknownResponseSchema,
        generate: async () => ({
          response: { value: 42 },
          usage: {
            inputTokens: 10,
            outputTokens: 2,
            cachedInputTokens: 0,
            costUsd: 0.01,
          },
        }),
      });
    } catch (error: unknown) {
      failure = error;
    }
    if (!(failure instanceof ApplicationFailure)) {
      throw new TypeError("Expected a non-retryable ApplicationFailure");
    }
    expect(failure.type).toBe("BilledGenerationFinalizationError");
    expect(failure.nonRetryable).toBe(true);
    expect(createCount).toBe(0);
  });
});

describe("Glitter billed completion artifacts", () => {
  test("fails non-retryably when a billed response cannot be persisted", async () => {
    let generationCount = 0;
    const store: GenerationArtifactStore = {
      read: () => Promise.resolve(),
      create: async () => {
        throw new Error("SeaweedFS unavailable");
      },
    };

    let failure: unknown;
    try {
      await readOrCreateGenerationArtifact({
        store,
        model: "test-model",
        callSite: "style-card",
        request: { prompt: "billed but not persisted" },
        responseSchema: ResponseSchema,
        generate: async () => {
          generationCount += 1;
          return {
            response: { value: "paid result" },
            usage: {
              inputTokens: 10,
              outputTokens: 2,
              cachedInputTokens: 0,
              costUsd: 0.01,
            },
          };
        },
      });
    } catch (error: unknown) {
      failure = error;
    }
    if (!(failure instanceof ApplicationFailure)) {
      throw new TypeError("Expected a non-retryable ApplicationFailure");
    }
    expect(failure.type).toBe("BilledGenerationFinalizationError");
    expect(failure.nonRetryable).toBe(true);
    expect(failure.message).toContain("Automatic retry is disabled");
    expect(failure.details).toEqual([
      {
        key: generationArtifactKey({
          callSite: "style-card",
          requestSha256: generationRequestSha256({
            prompt: "billed but not persisted",
          }),
        }),
        model: "test-model",
        callSite: "style-card",
        requestSha256: generationRequestSha256({
          prompt: "billed but not persisted",
        }),
        usage: {
          inputTokens: 10,
          outputTokens: 2,
          cachedInputTokens: 0,
          costUsd: 0.01,
        },
        reason: "SeaweedFS unavailable",
      },
    ]);
    expect(generationCount).toBe(1);
  });

  test("persists billed parse failures so an activity retry cannot spend twice", async () => {
    const { store } = memoryStore();
    const CompletionArtifactSchema =
      glitterCompletionArtifactSchema(ResponseSchema);
    const budget = new GenerationBudget(1);
    let generationCount = 0;
    const run = async () => {
      const artifact = await readOrCreateGenerationArtifact({
        store,
        model: "test-model",
        callSite: "style-card",
        request: { prompt: "stable failed completion", seed: 0 },
        responseSchema: CompletionArtifactSchema,
        generate: async () => {
          generationCount += 1;
          return {
            response: {
              outcome: "failure" as const,
              error: "model returned no parsed payload",
              rawContent: '{"value":42}',
            },
            usage: {
              inputTokens: 10,
              outputTokens: 2,
              cachedInputTokens: 0,
              costUsd: 0.01,
            },
          };
        },
      });
      return () =>
        useGlitterCompletionArtifact({
          artifact,
          budget,
        });
    };

    expect(await run()).toThrow("model returned no parsed payload");
    expect(await run()).toThrow("model returned no parsed payload");
    expect(generationCount).toBe(1);
    expect(budget.summary()).toMatchObject({
      actualUncachedCostUsd: 0.01,
      cacheMisses: 1,
      cacheHits: 1,
    });
  });
});
