import { describe, expect, test } from "vitest";
import {
  createLlmRuntime,
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
    id: "msg_tier3_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    // Structurally wrong for Tier3ResultSchema, so every semantic attempt
    // fails validation and the retry budget is exhausted.
    content: [{ type: "text", text: '{"categoryId":17}' }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: PROMPT_TOKENS,
      output_tokens: COMPLETION_TOKENS,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  });
}

describe("finalizeTier3", () => {
  test("records every billable attempt when the finalizer exhausts its retries", async () => {
    let requests = 0;
    const runtime = createLlmRuntime({
      credentials: { anthropic: { kind: "apiKey", apiKey: "test-key" } },
      service: "monarch-tier3-test",
      appName: "Monarch tier3 test",
      fetch: Object.assign(
        () => {
          requests += 1;
          return Promise.resolve(invalidResultResponse());
        },
        {
          preconnect: (_url: string | URL) => {
            // No preconnect in tests.
          },
        },
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
