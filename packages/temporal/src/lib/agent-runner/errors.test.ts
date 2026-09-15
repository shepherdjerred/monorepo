import { describe, expect, test } from "vitest";
import {
  AgentTurnExecutionError,
  agentTurnExecutionError,
  isAuthOrQuotaFailure,
  nonRetryableGenerationFailure,
} from "./errors.ts";

describe("agent turn error classification", () => {
  test.each([
    "401 Unauthorized",
    "invalid_api_key",
    "insufficient_quota",
    "weekly limit reached",
    "credits required",
  ])("classifies terminal credential failures: %s", (message) => {
    expect(isAuthOrQuotaFailure(new Error(message))).toBe(true);
  });

  test("retains execution state and the original cause", () => {
    const cause = new Error("provider disconnected");
    const error = agentTurnExecutionError({
      provider: "codex",
      cause,
      generationStarted: true,
      possiblyAppliedEffects: false,
      messagePrefix: "Codex Agent SDK run failed",
    });

    expect(error).toBeInstanceOf(AgentTurnExecutionError);
    expect(error.message).toBe(
      "Codex Agent SDK run failed: provider disconnected",
    );
    expect(error.cause).toBe(cause);
    expect(error.generationStarted).toBe(true);
    expect(error.possiblyAppliedEffects).toBe(false);
    expect(error.authOrQuotaFailure).toBe(false);
  });

  test.each([
    [false, "ExampleBilledGenerationFailure"],
    [true, "ExamplePossiblyAppliedFailure"],
  ] as const)(
    "creates a non-retryable Temporal failure for effect state %s",
    (possiblyAppliedEffects, expectedType) => {
      const executionError = new AgentTurnExecutionError("failed", {
        provider: "codex",
        generationStarted: true,
        possiblyAppliedEffects,
        authOrQuotaFailure: false,
      });

      const failure = nonRetryableGenerationFailure(executionError, "Example");

      expect(failure.type).toBe(expectedType);
      expect(failure.nonRetryable).toBe(true);
      expect(failure.cause).toBe(executionError);
    },
  );
});
