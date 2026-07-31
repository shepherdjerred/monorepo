import { describe, expect, test } from "bun:test";
import { z } from "zod/v4";
import { ApplicationFailure } from "@temporalio/common";
import {
  generationArtifactKey,
  generationRequestSha256,
  generationSpendReceiptKey,
  readOrCreateGenerationArtifact,
  type GenerationArtifactStore,
} from "./glitter-context-refresh-cache.ts";
import { GenerationBudget } from "./glitter-context-refresh-budget.ts";
import {
  glitterCompletionArtifact,
  glitterCompletionArtifactSchema,
  useGlitterCompletionArtifact,
} from "./glitter-context-refresh-openai.ts";

const ResponseSchema = z.strictObject({ value: z.string() });
const UnknownResponseSchema: z.ZodType = ResponseSchema;
const CURRENT_RUN_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_RUN_ID = "00000000-0000-4000-8000-000000000002";

function memoryStore(ownerRunId = CURRENT_RUN_ID): {
  store: GenerationArtifactStore;
  values: Map<string, unknown>;
} {
  const values = new Map<string, unknown>();
  return {
    values,
    store: {
      ownerRunId,
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
    expect(reused.billedToCurrentRun).toBe(true);
    expect(generationCount).toBe(1);
    expect(values.size).toBe(2);
  });

  test("uses the atomic first-writer result after a create race", async () => {
    const winner = memoryStore(OTHER_RUN_ID);
    const store: GenerationArtifactStore = {
      ownerRunId: CURRENT_RUN_ID,
      read: winner.store.read,
      create: async (key, value) => {
        if (key.includes("/run-spend/")) {
          await winner.store.create(key, value);
          return;
        }
        await winner.store.create(key, {
          schemaVersion: 3,
          ownerRunId: OTHER_RUN_ID,
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
          inputTokens: 20,
          outputTokens: 4,
          cachedInputTokens: 0,
          costUsd: 0.02,
        },
      }),
    });

    expect(result.response).toEqual({ value: "winner" });
    expect(result.cacheStatus).toBe("miss");
    expect(result.billedToCurrentRun).toBe(true);
    expect(result.usage).toEqual({
      inputTokens: 20,
      outputTokens: 4,
      cachedInputTokens: 0,
      costUsd: 0.02,
    });
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
          schemaVersion: 3,
          ownerRunId: CURRENT_RUN_ID,
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
      ownerRunId: CURRENT_RUN_ID,
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
      ownerRunId: CURRENT_RUN_ID,
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
    expect(createCount).toBe(1);
  });
});

describe("Glitter billed completion artifacts", () => {
  test("fails non-retryably when a billable response omits usage", () => {
    let failure: unknown;
    try {
      glitterCompletionArtifact({
        model: "test-model",
        parsed: { value: "paid result" },
        rawContent: '{"value":"paid result"}',
        usage: undefined,
        missingParsedError: "unused",
      });
    } catch (error: unknown) {
      failure = error;
    }
    if (!(failure instanceof ApplicationFailure)) {
      throw new TypeError("Expected a non-retryable ApplicationFailure");
    }
    expect(failure.type).toBe("BilledGenerationUsageUnavailable");
    expect(failure.nonRetryable).toBe(true);
    expect(failure.message).toContain("may already have been charged");
  });

  test("fails non-retryably when a billed response cannot be persisted", async () => {
    const memory = memoryStore();
    let generationCount = 0;
    const store: GenerationArtifactStore = {
      ownerRunId: CURRENT_RUN_ID,
      read: memory.store.read,
      create: async (key, value) => {
        if (key.includes("/run-spend/")) {
          await memory.store.create(key, value);
          return;
        }
        throw new Error("SeaweedFS unavailable");
      },
    };

    const run = async () =>
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

    let firstFailure: unknown;
    try {
      await run();
    } catch (error: unknown) {
      firstFailure = error;
    }
    if (!(firstFailure instanceof ApplicationFailure)) {
      throw new TypeError("Expected a non-retryable ApplicationFailure");
    }
    expect(firstFailure.type).toBe("BilledGenerationFinalizationError");
    expect(firstFailure.nonRetryable).toBe(true);
    expect(firstFailure.message).toContain("Automatic retry is disabled");
    expect(firstFailure.details).toEqual([
      {
        key: generationArtifactKey({
          callSite: "style-card",
          requestSha256: generationRequestSha256({
            prompt: "billed but not persisted",
          }),
        }),
        model: "test-model",
        callSite: "style-card",
        ownerRunId: CURRENT_RUN_ID,
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

    let retryFailure: unknown;
    try {
      await run();
    } catch (error: unknown) {
      retryFailure = error;
    }
    if (!(retryFailure instanceof ApplicationFailure)) {
      throw new TypeError("Expected a non-retryable retry ApplicationFailure");
    }
    expect(retryFailure.type).toBe("BilledGenerationReceiptWithoutArtifact");
    expect(retryFailure.nonRetryable).toBe(true);
    expect(retryFailure.details).toEqual([
      {
        key: generationArtifactKey({
          callSite: "style-card",
          requestSha256: generationRequestSha256({
            prompt: "billed but not persisted",
          }),
        }),
        spendReceiptKey: generationSpendReceiptKey({
          ownerRunId: CURRENT_RUN_ID,
          callSite: "style-card",
          requestSha256: generationRequestSha256({
            prompt: "billed but not persisted",
          }),
        }),
        ownerRunId: CURRENT_RUN_ID,
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
      },
    ]);
    expect(generationCount).toBe(1);
  });

  test("persists billed parse failures so an activity retry cannot spend twice", async () => {
    const { store } = memoryStore();
    const CompletionArtifactSchema =
      glitterCompletionArtifactSchema(ResponseSchema);
    let generationCount = 0;
    const run = async (budget: GenerationBudget) => {
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

    const firstAttemptBudget = new GenerationBudget(1);
    const retryBudget = new GenerationBudget(1);
    expect(await run(firstAttemptBudget)).toThrow(
      "model returned no parsed payload",
    );
    expect(await run(retryBudget)).toThrow("model returned no parsed payload");
    expect(generationCount).toBe(1);
    expect(firstAttemptBudget.summary()).toMatchObject({
      actualUncachedCostUsd: 0.01,
      cacheMisses: 1,
      cacheHits: 0,
    });
    expect(retryBudget.summary()).toMatchObject({
      actualUncachedCostUsd: 0.01,
      cacheMisses: 0,
      cacheHits: 1,
    });
  });
});
