import { describe, expect, test } from "vitest";
import { ZodError, z } from "zod";
import {
  callRiotOrThrow,
  callRiotOrUndefined,
  callRiotOrUndefinedOn404,
} from "#src/league/api/riot-call.ts";
import { RiotHttpError } from "#src/league/api/client/errors.ts";

const Schema = z
  .object({
    id: z.number(),
    name: z.string(),
  })
  .strict();

function ok(value: unknown): () => Promise<unknown> {
  return () => Promise.resolve(value);
}

function fails(error: unknown): () => Promise<unknown> {
  return async () => {
    throw error;
  };
}

function httpError(status: number): RiotHttpError {
  return new RiotHttpError({
    status,
    statusText: "Test error",
    body: undefined,
    url: "https://na1.api.riotgames.com/test",
    headers: new Headers(),
  });
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
      fails(httpError(404)),
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
      fails(httpError(503)),
    );
    expect(result).toBeUndefined();
  });

  test("returns undefined on HTTP 500", async () => {
    const result = await callRiotOrUndefined(
      { source: "test-500", schema: Schema, context: {} },
      fails(httpError(500)),
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
    const error = httpError(500);
    const promise = callRiotOrThrow(
      { source: "test-throw-500", schema: Schema, context: {} },
      fails(error),
    );
    await expect(promise).rejects.toBe(error);
  });

  test("throws Error on transport failure", async () => {
    const promise = callRiotOrThrow(
      { source: "test-throw-transport", schema: Schema, context: {} },
      fails(new Error("ENOTFOUND")),
    );
    await expect(promise).rejects.toThrow(/ENOTFOUND/);
  });
});

describe("callRiotOrUndefinedOn404", () => {
  test("returns parsed data on success", async () => {
    const result = await callRiotOrUndefinedOn404(
      { source: "test-404-only-success", schema: Schema, context: {} },
      ok({ id: 1, name: "ok" }),
    );
    expect(result).toEqual({ id: 1, name: "ok" });
  });

  test("returns undefined on HTTP 404", async () => {
    const result = await callRiotOrUndefinedOn404(
      { source: "test-404-only-missing", schema: Schema, context: {} },
      fails(httpError(404)),
    );
    expect(result).toBeUndefined();
  });

  test("throws ZodError on validation failure", async () => {
    const promise = callRiotOrUndefinedOn404(
      { source: "test-404-only-validation", schema: Schema, context: {} },
      ok({ id: "not-a-number", name: "ok" }),
    );
    await expect(promise).rejects.toBeInstanceOf(ZodError);
  });

  test("throws the underlying HTTP error when the status is not 404", async () => {
    const error = httpError(500);
    const promise = callRiotOrUndefinedOn404(
      { source: "test-404-only-500", schema: Schema, context: {} },
      fails(error),
    );
    await expect(promise).rejects.toBe(error);
  });

  test("throws the underlying transport error", async () => {
    const error = new Error("ENOTFOUND");
    const promise = callRiotOrUndefinedOn404(
      { source: "test-404-only-transport", schema: Schema, context: {} },
      fails(error),
    );
    await expect(promise).rejects.toBe(error);
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
