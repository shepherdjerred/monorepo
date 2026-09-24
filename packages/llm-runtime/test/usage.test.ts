import { describe, expect, test } from "vitest";
import {
  addTokenBreakdown,
  emptyTokenBreakdown,
  parseNativeUsage,
  tokenBreakdown,
} from "@shepherdjerred/llm-runtime";

/** The AI SDK's normalized usage, as every provider reports it. */
function sdkUsage(input: {
  noCache: number;
  cacheRead?: number;
  cacheWrite?: number;
  output: number;
  reasoning?: number;
  raw?: Record<string, unknown>;
}) {
  const cacheRead = input.cacheRead ?? 0;
  const cacheWrite = input.cacheWrite ?? 0;
  return {
    inputTokens: input.noCache + cacheRead + cacheWrite,
    inputTokenDetails: {
      noCacheTokens: input.noCache,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
    },
    outputTokens: input.output,
    outputTokenDetails: { reasoningTokens: input.reasoning ?? 0 },
    totalTokens: input.noCache + cacheRead + cacheWrite + input.output,
    ...(input.raw === undefined ? {} : { raw: input.raw }),
  };
}

describe("token breakdown", () => {
  test("reads the SDK's non-overlapping input details", () => {
    expect(
      tokenBreakdown(
        sdkUsage({ noCache: 10, cacheRead: 5, cacheWrite: 2, output: 3 }),
      ),
    ).toEqual({
      input: 10,
      output: 3,
      cachedInput: 5,
      cacheWrite: 2,
      reasoning: 0,
      total: 20,
    });
  });

  test("derives uncached input when the SDK omits the detail", () => {
    // Falling back to the inclusive `inputTokens` would double-count the cache
    // read that is also reported in `cachedInput`.
    expect(
      tokenBreakdown({
        inputTokens: 17,
        inputTokenDetails: { cacheReadTokens: 5, cacheWriteTokens: 2 },
        outputTokens: 3,
      }),
    ).toMatchObject({ input: 10, cachedInput: 5, cacheWrite: 2 });
  });

  test("unparseable usage is zero, not a thrown call", () => {
    expect(tokenBreakdown(undefined)).toEqual(emptyTokenBreakdown());
    expect(tokenBreakdown("nonsense")).toEqual(emptyTokenBreakdown());
  });

  test("breakdowns add field-wise", () => {
    const one = tokenBreakdown(sdkUsage({ noCache: 1, output: 2 }));
    const two = tokenBreakdown(sdkUsage({ noCache: 3, output: 4 }));
    expect(addTokenBreakdown(one, two)).toMatchObject({ input: 4, output: 6 });
  });
});

describe("native usage metadata", () => {
  test("prices an OpenAI call from the catalog", () => {
    const metadata = parseNativeUsage({
      requestedModel: "gpt-5.4-nano",
      provider: "openai",
      usage: sdkUsage({ noCache: 1_000_000, output: 0 }),
    });
    expect(metadata.provider).toBe("openai");
    expect(metadata.catalogCostUsd).toBeCloseTo(0.2, 9);
    expect(metadata.serviceTier).toBeUndefined();
  });

  test("reads Anthropic's TTL split, tier, and tool counts out of raw usage", () => {
    const metadata = parseNativeUsage({
      requestedModel: "claude-haiku-4-5",
      provider: "anthropic",
      usage: sdkUsage({
        noCache: 0,
        cacheWrite: 1_000_000,
        output: 0,
        raw: {
          service_tier: "batch",
          cache_creation: {
            ephemeral_5m_input_tokens: 400_000,
            ephemeral_1h_input_tokens: 600_000,
          },
          server_tool_use: { web_search_requests: 2 },
        },
      }),
    });
    expect(metadata.serviceTier).toBe("batch");
    expect(metadata.cacheWriteByTtl).toEqual({ "5m": 400_000, "1h": 600_000 });
    expect(metadata.serverToolRequests).toEqual({ webSearch: 2 });
    // (0.4 * 1.25 + 0.6 * 2) tokens + 2 searches at $0.01, all halved by batch.
    expect(metadata.catalogCostUsd).toBeCloseTo((0.5 + 1.2 + 0.02) / 2, 9);
  });

  test("ignores raw pricing fields from providers that do not report them", () => {
    // Only Anthropic publishes these. Reading them off an OpenAI response would
    // be interpreting another vendor's field names by coincidence.
    const metadata = parseNativeUsage({
      requestedModel: "gpt-5.4-nano",
      provider: "openai",
      usage: sdkUsage({
        noCache: 1000,
        output: 0,
        raw: { service_tier: "batch" },
      }),
    });
    expect(metadata.serviceTier).toBeUndefined();
    expect(metadata.catalogCostUsd).toBeCloseTo(0.0002, 9);
  });

  test("an unpriceable call reports no cost rather than an understated one", () => {
    const metadata = parseNativeUsage({
      requestedModel: "gpt-5.4-nano",
      provider: "anthropic",
      usage: sdkUsage({
        noCache: 1000,
        output: 0,
        raw: { server_tool_use: { web_search_requests: 1 } },
      }),
    });
    expect(metadata.serverToolRequests).toEqual({ webSearch: 1 });
    expect(metadata.catalogCostUsd).toBeUndefined();
  });
});
