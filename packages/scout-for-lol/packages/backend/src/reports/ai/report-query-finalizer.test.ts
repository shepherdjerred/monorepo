import { afterEach, expect, test } from "vitest";
import { Registry } from "prom-client";
import {
  createOpenRouterRuntime,
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
    id: "gen-finalizer-test",
    model: "openai/gpt-5.6-sol",
    choices: [
      {
        index: 0,
        // Structurally wrong for ReportAiFinalDraftSchema, so every semantic
        // attempt fails validation and the retry budget is exhausted.
        message: { role: "assistant", content: '{"queryText":42}' },
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

afterEach(() => {
  resetBudgetStateForTests();
});

test("charges every billable attempt when the finalizer exhausts its retries", async () => {
  resetBudgetStateForTests();
  let requests = 0;
  const runtime = createOpenRouterRuntime({
    apiKey: "test-key",
    service: "scout-finalizer-test",
    appName: "Scout finalizer test",
    metricsRegister: new Registry(),
    fetch: Object.assign(
      () => {
        requests += 1;
        return Promise.resolve(invalidDraftResponse());
      },
      { preconnect: (url: string | URL) => void url },
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
