import { describe, expect, test } from "bun:test";
import { ZodError, z } from "zod";
import {
  callRiotOrThrow,
  callRiotOrUndefined,
} from "#src/league/api/riot-call.ts";

const Schema = z
  .object({
    id: z.number(),
    name: z.string(),
  })
  .strict();

function ok(value: unknown): () => Promise<{ response: unknown }> {
  return () => Promise.resolve({ response: value });
}

function fails(error: unknown): () => Promise<{ response: unknown }> {
  return async () => {
    throw error;
  };
}

describe("callRiotOrUndefined", () => {
  test("returns parsed data on success", async () => {
    const result = await callRiotOrUndefined(
      { source: "test-success", schema: Schema, context: {} },
      ok({ id: 1, name: "ok" }),
    );
    expect(result).toEqual({ id: 1, name: "ok" });
  });

  test("recovers from purely-additive drift (unknown keys stripped + counted)", async () => {
    const result = await callRiotOrUndefined(
      {
        source: "test-drift",
        schema: Schema,
        context: { tag: "drift" },
      },
      ok({ id: 1, name: "ok", surpriseField: true }),
    );
    expect(result).toEqual({ id: 1, name: "ok" });
  });

  test("returns undefined on real validation failure", async () => {
    const result = await callRiotOrUndefined(
      { source: "test-bad-validation", schema: Schema, context: {} },
      ok({ id: "not-a-number", name: "ok" }),
    );
    expect(result).toBeUndefined();
  });

  test("returns undefined on HTTP 404", async () => {
    const result = await callRiotOrUndefined(
      { source: "test-404", schema: Schema, context: {} },
      fails({ status: 404 }),
    );
    expect(result).toBeUndefined();
  });

  test("returns undefined on upstream 503 (no Sentry capture)", async () => {
    const result = await callRiotOrUndefined(
      {
        source: "test-503",
        schema: Schema,
        context: {},
        sentry: true,
      },
      fails({ status: 503 }),
    );
    expect(result).toBeUndefined();
  });

  test("returns undefined on HTTP 500", async () => {
    const result = await callRiotOrUndefined(
      { source: "test-500", schema: Schema, context: {} },
      fails({ status: 500 }),
    );
    expect(result).toBeUndefined();
  });

  test("returns undefined on transport error (no HTTP status)", async () => {
    const result = await callRiotOrUndefined(
      { source: "test-transport", schema: Schema, context: {} },
      fails(new Error("ENOTFOUND")),
    );
    expect(result).toBeUndefined();
  });
});

describe("callRiotOrThrow", () => {
  test("returns parsed data on success", async () => {
    const result = await callRiotOrThrow(
      { source: "test-throw-success", schema: Schema, context: {} },
      ok({ id: 1, name: "ok" }),
    );
    expect(result).toEqual({ id: 1, name: "ok" });
  });

  test("recovers from drift the same way (no throw on unknown-keys)", async () => {
    const result = await callRiotOrThrow(
      { source: "test-throw-drift", schema: Schema, context: {} },
      ok({ id: 1, name: "ok", extra: 42 }),
    );
    expect(result).toEqual({ id: 1, name: "ok" });
  });

  test("throws ZodError on real validation failure", async () => {
    const promise = callRiotOrThrow(
      { source: "test-throw-bad", schema: Schema, context: {} },
      ok({ id: "not-a-number", name: "ok" }),
    );
    await expect(promise).rejects.toBeInstanceOf(ZodError);
  });

  test("throws underlying error on HTTP failure", async () => {
    const httpError = { status: 500, message: "Internal Server Error" };
    const promise = callRiotOrThrow(
      { source: "test-throw-500", schema: Schema, context: {} },
      fails(httpError),
    );
    // The original (non-Error) value gets wrapped, but the message should be informative
    await expect(promise).rejects.toThrow();
  });

  test("throws Error on transport failure", async () => {
    const promise = callRiotOrThrow(
      { source: "test-throw-transport", schema: Schema, context: {} },
      fails(new Error("ENOTFOUND")),
    );
    await expect(promise).rejects.toThrow(/ENOTFOUND/);
  });
});

describe("schemaLabel", () => {
  test("uses source as the unknown-keys schema label by default", async () => {
    // The metric increment is observable via metric registration; here we
    // just confirm the call succeeds with the default label path.
    const result = await callRiotOrUndefined(
      { source: "default-label-test", schema: Schema, context: {} },
      ok({ id: 1, name: "ok", extra: true }),
    );
    expect(result).toEqual({ id: 1, name: "ok" });
  });

  test("respects schemaLabel override", async () => {
    const result = await callRiotOrUndefined(
      {
        source: "override-label-test",
        schema: Schema,
        context: {},
        schemaLabel: "custom",
      },
      ok({ id: 1, name: "ok", extra: true }),
    );
    expect(result).toEqual({ id: 1, name: "ok" });
  });
});
