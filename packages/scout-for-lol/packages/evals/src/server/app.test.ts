import { afterEach, describe, expect, test } from "bun:test";
import { z } from "zod";

import { createApp } from "#server/app.ts";
import { createEvalStore, type EvalStore } from "#server/store.ts";
import { DatasetSummarySchema } from "#shared/schema.ts";

const DatasetResponseSchema = z.strictObject({
  result: z.strictObject({
    data: DatasetSummarySchema,
  }),
});

const stores: EvalStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function testApp(): ReturnType<typeof createApp> {
  const store = createEvalStore(":memory:");
  stores.push(store);
  return createApp(store);
}

function trpcRequest(input: unknown): RequestInit {
  return {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  };
}

describe("eval HTTP app", () => {
  test("reports health", async () => {
    const response = await testApp().request("/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("creates a dataset through the tRPC boundary", async () => {
    const response = await testApp().request(
      "/trpc/datasets.create",
      trpcRequest({
        description: "Initial calibration",
        key: "cal",
        name: "Calibration 20",
      }),
    );

    expect(response.status).toBe(200);
    const payload = DatasetResponseSchema.parse(await response.json());
    expect(payload.result.data).toMatchObject({
      caseCount: 0,
      key: "cal",
      name: "Calibration 20",
      status: "draft",
      version: 1,
    });
  });

  test("rejects invalid tRPC input before it reaches SQLite", async () => {
    const response = await testApp().request(
      "/trpc/datasets.create",
      trpcRequest({
        description: "",
        key: "",
        name: "",
      }),
    );

    expect(response.status).toBe(400);
  });
});
