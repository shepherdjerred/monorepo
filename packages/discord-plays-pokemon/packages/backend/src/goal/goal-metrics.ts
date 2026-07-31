import type { GoalState } from "./goal-types.ts";
import {
  goalActive,
  goalDurationSeconds,
  goalRunsTotal,
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
