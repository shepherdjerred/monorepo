import { describe, expect, test } from "bun:test";
import {
  createOpenRouterRuntime,
  MAX_SEMANTIC_ATTEMPTS,
  StructuredOutputExhaustionError,
} from "@shepherdjerred/llm-runtime";
import { createUsageTracker } from "../usage.ts";
import { finalizeTier3 } from "./tier3.ts";

const MODEL = "claude-sonnet-5";
const PROMPT_TOKENS = 30;
const COMPLETION_TOKENS = 7;

function invalidResultResponse(): Response {
  return Response.json({
    id: "gen-tier3-test",
    model: "anthropic/claude-sonnet-5",
    choices: [
      {
        index: 0,
        // Structurally wrong for Tier3ResultSchema, so every semantic attempt
        // fails validation and the retry budget is exhausted.
        message: { role: "assistant", content: '{"categoryId":17}' },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: PROMPT_TOKENS,
      completion_tokens: COMPLETION_TOKENS,
      total_tokens: PROMPT_TOKENS + COMPLETION_TOKENS,
    },
  });
}

describe("finalizeTier3", () => {
  test("records every billable attempt when the finalizer exhausts its retries", async () => {
    let requests = 0;
    const runtime = createOpenRouterRuntime({
      apiKey: "test-key",
      service: "monarch-tier3-test",
      appName: "Monarch tier3 test",
      fetch: Object.assign(
        () => {
          requests += 1;
          return Promise.resolve(invalidResultResponse());
        },
        { preconnect: (url: string | URL) => void url },
      ),
    });
    const tracker = createUsageTracker(MODEL);

    const attempt = finalizeTier3({
      runtime,
      modelId: MODEL,
      tracker,
      prompt: "Classify this transaction.",
      evidence: "[]",
    });

    await expect(attempt).rejects.toBeInstanceOf(
      StructuredOutputExhaustionError,
    );
    expect(requests).toBe(MAX_SEMANTIC_ATTEMPTS);
    // classifySingleTier3 swallows this error and keeps going, so without the
    // exhaustion accounting the run summary would omit these tokens entirely.
    const summary = tracker.getSummary();
    expect(summary.inputTokens).toBe(PROMPT_TOKENS * MAX_SEMANTIC_ATTEMPTS);
    expect(summary.outputTokens).toBe(
      COMPLETION_TOKENS * MAX_SEMANTIC_ATTEMPTS,
    );
    expect(summary.estimatedCost).toBeGreaterThan(0);
  });
});
