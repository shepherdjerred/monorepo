import { StructuredOutputExhaustionError } from "@shepherdjerred/llm-runtime";
import { LlmBudgetExceeded } from "#src/league/review/openai-budget.ts";

/**
 * Shared classification for the failures every Bryan Bucks model boundary
 * has in common.
 *
 * It lives in its own module rather than beside either consumer: the dare
 * translation boundary must not have to import the parlay generation
 * pipeline (pricing, persistence, Discord delivery) to learn what a timeout
 * is, and a second hand-written copy is exactly how the two would drift.
 */

function timedOut(signal: AbortSignal, error: unknown): boolean {
  return (
    signal.aborted ||
    (error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  );
}

/**
 * Budget refusal, deadline expiry, and structured-output exhaustion.
 * `undefined` means "not one of the shared classes" — each caller layers its
 * own boundary-specific classes (parlay persistence and pricing, provider
 * errors in dare translation) on top.
 */
export function sharedLlmFailureKind(
  deadline: AbortSignal,
  error: unknown,
): "budget_refused" | "timeout" | "invalid_output" | undefined {
  if (error instanceof LlmBudgetExceeded) return "budget_refused";
  if (timedOut(deadline, error)) return "timeout";
  if (error instanceof StructuredOutputExhaustionError) return "invalid_output";
  return;
}
