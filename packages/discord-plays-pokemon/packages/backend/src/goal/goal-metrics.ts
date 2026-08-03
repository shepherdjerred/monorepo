import type { CodexTurnUsage } from "@shepherdjerred/llm-observability/codex-jsonl";
import type { GoalState } from "./goal-types.ts";
import {
  goalActive,
  goalCostUsdTotal,
  goalDurationSeconds,
  goalRunsTotal,
  goalTokensTotal,
} from "#src/observability/metrics.ts";

export function recordGoalStarted(): void {
  goalActive.inc();
}

export function recordGoalFinished(state: GoalState): void {
  if (state.status === "running" || state.finishedAt === undefined) {
    throw new TypeError("Terminal goal metrics require a finished goal state");
  }
  const startedAt = Date.parse(state.startedAt);
  const finishedAt = Date.parse(state.finishedAt);
  if (Number.isNaN(startedAt) || Number.isNaN(finishedAt)) {
    throw new TypeError("Goal metrics require valid lifecycle timestamps");
  }
  const durationSeconds = Math.max(0, (finishedAt - startedAt) / 1000);
  goalActive.dec();
  goalRunsTotal.inc({ status: state.status });
  goalDurationSeconds.observe({ status: state.status }, durationSeconds);
}

/**
 * Account a terminal goal run's aggregate token usage and estimated cost.
 * Called from every terminal path (finish, timeout, replace, shutdown) so
 * killed runs still show up in the cost series. `costUsd` is null when the
 * model has no configured pricing.
 */
export function recordGoalUsage(
  usage: CodexTurnUsage,
  costUsd: number | null,
): void {
  goalTokensTotal.inc({ kind: "input" }, usage.inputTokens);
  goalTokensTotal.inc({ kind: "cached" }, usage.cachedInputTokens);
  goalTokensTotal.inc({ kind: "output" }, usage.outputTokens);
  goalTokensTotal.inc({ kind: "reasoning" }, usage.reasoningOutputTokens);
  if (costUsd !== null && costUsd > 0) {
    goalCostUsdTotal.inc(costUsd);
  }
}
