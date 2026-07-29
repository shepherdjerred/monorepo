import { describe, expect, test } from "bun:test";
import { z } from "zod/v4";
import {
  generationArtifactKey,
  generationRequestSha256,
  readOrCreateGenerationArtifact,
  type GenerationArtifactStore,
} from "./glitter-context-refresh-cache.ts";

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
          return { value };
        },
      });

    expect(await run("first")).toEqual({ value: "first" });
    expect(await run("different")).toEqual({ value: "first" });
    expect(generationCount).toBe(1);
    expect(values.size).toBe(1);
  });

  test("uses the atomic first-writer result after a create race", async () => {
    const winner = memoryStore();
    const store: GenerationArtifactStore = {
      read: winner.store.read,
      create: async (key) => {
        await winner.store.create(key, {
          schemaVersion: 1,
          model: "test-model",
          callSite: "style-card",
          requestSha256: generationRequestSha256({ prompt: "same" }),
          responseSha256: generationRequestSha256({ value: "winner" }),
          response: { value: "winner" },
        });
      },
    };

    const result = await readOrCreateGenerationArtifact({
      store,
      model: "test-model",
      callSite: "style-card",
      request: { prompt: "same" },
      responseSchema: ResponseSchema,
      generate: async () => ({ value: "loser" }),
    });

    expect(result).toEqual({ value: "winner" });
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
          schemaVersion: 1,
          model: "test-model",
          callSite: "style-card",
          requestSha256,
          responseSha256: "0".repeat(64),
          response: { value: "corrupt" },
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
        generate: async () => ({ value: "unused" }),
      }),
    ).rejects.toThrow("response checksum mismatch");
  });

  test("does not persist a schema-invalid generated response", async () => {
    let createCount = 0;
    const store: GenerationArtifactStore = {
      read: () => Promise.resolve(),
      create: async () => {
        createCount += 1;
      },
    };

    await expect(
      readOrCreateGenerationArtifact({
        store,
        model: "test-model",
        callSite: "style-card",
        request: { prompt: "stable prompt" },
        responseSchema: UnknownResponseSchema,
        generate: async () => ({ value: 42 }),
      }),
    ).rejects.toThrow();
    expect(createCount).toBe(0);
  });
});
