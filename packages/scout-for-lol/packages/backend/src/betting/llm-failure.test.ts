import { describe, expect, test } from "vitest";
import {
  StructuredOutputExhaustionError,
  emptyTokenBreakdown,
} from "@shepherdjerred/llm-runtime";
import { LlmBudgetExceeded } from "#src/league/review/openai-budget.ts";
import { sharedLlmFailureKind } from "#src/betting/llm-failure.ts";

const deadline = new AbortController().signal;

function quotaError(): Error {
  return Object.assign(new Error("Key limit exceeded (weekly limit)"), {
    statusCode: 403,
  });
}

describe("sharedLlmFailureKind", () => {
  test("classifies provider quota exhaustion", () => {
    expect(sharedLlmFailureKind(deadline, quotaError())).toBe("provider_quota");
  });

  test("classifies credit exhaustion", () => {
    const error = Object.assign(new Error("Insufficient credits"), {
      statusCode: 402,
    });
    expect(sharedLlmFailureKind(deadline, error)).toBe("provider_quota");
  });

  test("leaves plain rate limits to the caller's provider-error path", () => {
    // A bare 429 is transient and worth retrying; only quota-flavored
    // rate limits (billing/quota/insufficient_quota in the message) are
    // terminal.
    const error = Object.assign(new Error("Too many requests"), {
      statusCode: 429,
    });
    expect(sharedLlmFailureKind(deadline, error)).toBeUndefined();
  });

  test("preserves the existing shared classes", () => {
    expect(
      sharedLlmFailureKind(deadline, new LlmBudgetExceeded("hourly", 3, 2)),
    ).toBe("budget_refused");
    expect(
      sharedLlmFailureKind(AbortSignal.abort(), new Error("unrelated")),
    ).toBe("timeout");
    expect(
      sharedLlmFailureKind(
        deadline,
        new StructuredOutputExhaustionError("nope", [], {
          tokens: emptyTokenBreakdown(),
          actualCostUsd: 0,
          catalogCostUsd: 0,
          upstreamCostUsd: 0,
        }),
      ),
    ).toBe("invalid_output");
    expect(sharedLlmFailureKind(deadline, new Error("boom"))).toBeUndefined();
  });
});
