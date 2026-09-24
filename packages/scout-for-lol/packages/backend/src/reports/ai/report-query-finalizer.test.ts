import { afterEach, expect, test } from "vitest";
import { Registry } from "prom-client";
import {
  createLlmRuntime,
  MAX_SEMANTIC_ATTEMPTS,
  StructuredOutputExhaustionError,
} from "@shepherdjerred/llm-runtime";
import {
  budgetUsageForTests,
  resetBudgetStateForTests,
} from "#src/league/review/openai-budget.ts";
import { finalizeReportDraft } from "#src/reports/ai/report-query-finalizer.ts";

const PROMPT_TOKENS = 40;
const COMPLETION_TOKENS = 11;

function invalidDraftResponse(): Response {
  return Response.json({
    id: "resp_finalizer_test",
    object: "response",
    model: "gpt-5.6-sol",
    status: "completed",
    output: [
      {
        type: "message",
        id: "msg_finalizer_test",
        role: "assistant",
        status: "completed",
        // Structurally wrong for ReportAiFinalDraftSchema, so every semantic
        // attempt fails validation and the retry budget is exhausted.
        content: [
          { type: "output_text", text: '{"queryText":42}', annotations: [] },
        ],
      },
    ],
    usage: {
      input_tokens: PROMPT_TOKENS,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: COMPLETION_TOKENS,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: PROMPT_TOKENS + COMPLETION_TOKENS,
    },
  });
}

afterEach(() => {
  resetBudgetStateForTests();
});

test("charges every billable attempt when the finalizer exhausts its retries", async () => {
  resetBudgetStateForTests();
  let requests = 0;
  const runtime = createLlmRuntime({
    credentials: { openai: { apiKey: "test-key" } },
    service: "scout-finalizer-test",
    appName: "Scout finalizer test",
    metricsRegister: new Registry(),
    fetch: Object.assign(
      () => {
        requests += 1;
        return Promise.resolve(invalidDraftResponse());
      },
      {
        preconnect: (_url: string | URL) => {
          // No connection warmup in tests; the stub fetch resolves immediately.
        },
      },
    ),
  });

  const attempt = finalizeReportDraft({
    runtime,
    model: "gpt-5.6-sol",
    runId: "run-1",
    prompt: "Rewrite the report.",
    evidence: "[]",
    abortSignal: AbortSignal.timeout(30_000),
  });

  await expect(attempt).rejects.toBeInstanceOf(StructuredOutputExhaustionError);
  expect(requests).toBe(MAX_SEMANTIC_ATTEMPTS);
  // Without this accounting, an exhausted edit spends real tokens that
  // assertWithinBudget() never sees, so repeated edits bypass the limits.
  expect(budgetUsageForTests().hourly).toBe(
    (PROMPT_TOKENS + COMPLETION_TOKENS) * MAX_SEMANTIC_ATTEMPTS,
  );
  expect(budgetUsageForTests().daily).toBe(
    (PROMPT_TOKENS + COMPLETION_TOKENS) * MAX_SEMANTIC_ATTEMPTS,
  );
});
