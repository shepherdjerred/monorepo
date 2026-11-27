import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  WEB_SEARCH_USD,
  batchCostUsd,
  createAnthropicBatchClient,
} from "#src/batch.ts";

const SubmittedSchema = z.object({
  requests: z.array(z.object({ params: z.object({ tools: z.unknown() }) })),
});

describe("server-side web search in a batch", () => {
  test("is declared by its versioned type with a use limit, and each search is priced on top of the tokens", async () => {
    const bodies: unknown[] = [];
    const client = createAnthropicBatchClient({
      credentials: { kind: "apiKey", apiKey: "test-key" },
      fetch: (_input, init) => {
        bodies.push(
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        );
        return Promise.resolve(
          Response.json({ id: "batch_1", processing_status: "in_progress" }),
        );
      },
      sleep: () => Promise.resolve(),
    });
    await client.submit([
      {
        customId: "unit-1",
        model: "claude-sonnet-5-5",
        messages: [{ role: "user", content: "check this" }],
        maxTokens: 1000,
        tools: [
          { type: "web_search_20260209", name: "web_search", maxUses: 2 },
        ],
      },
    ]);
    expect(SubmittedSchema.parse(bodies[0]).requests[0]?.params.tools).toEqual([
      { type: "web_search_20260209", name: "web_search", max_uses: 2 },
    ]);

    const usage = {
      inputTokens: 1000,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cacheWriteByTtl: {},
    };
    expect(
      batchCostUsd("claude-sonnet-5-5", { ...usage, webSearchRequests: 3 }) -
        batchCostUsd("claude-sonnet-5-5", usage),
    ).toBeCloseTo(3 * WEB_SEARCH_USD, 10);
  });
});
