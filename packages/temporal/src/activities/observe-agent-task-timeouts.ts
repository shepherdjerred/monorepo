import { Context } from "@temporalio/activity";
import * as Sentry from "@sentry/bun";
import { Gauge } from "prom-client";
import { createTemporalClient } from "#client";
import { register } from "#observability/metrics.ts";

// Defined here (importing the shared `register`) rather than in metrics.ts,
// which sits at its max-lines cap — the same sibling-module pattern
// pr-review-metrics.ts uses. This gauge has exactly one writer (the observer
// activity below), so it stays module-local rather than exported.
const agentTaskTimeouts24h = new Gauge({
  name: "temporal_agent_task_timeouts_24h",
  help: "Count of agentTaskWorkflow executions that closed as TimedOut in the last 24h. Steady state is 0 — a one-off/cron agent task should run to completion, not hit its run timeout. >0 means agent tasks are timing out again (e.g. a regression of the future-runAt startDelay fix, or an agent genuinely exceeding its run budget). -1 means the visibility scan itself failed (count unknown).",
  registers: [register],
});

/**
 * Guardrail observer: counts `agentTaskWorkflow` executions that closed as
 * `TimedOut` in the last 24h and records it on the
 * `temporal_agent_task_timeouts_24h` gauge (alert on `> 0`).
 *
 * Agent tasks time out via the run/execution timeout, which terminates the
 * workflow WITHOUT running any workflow code — so the workflow cannot
 * self-report the timeout. This external visibility scan is the only reliable
 * signal. Mirrors the `detectOrphanSchedules` gauge pattern: a failed scan sets
 * the gauge to -1 (alert on `< 0` separately) rather than a misleading 0.
 *
 * This is a pure regression detector: after the future-`runAt` startDelay fix,
 * steady state is 0. See packages/docs/plans/2026-07-30_agent-task-runat-timeout-fix.md.
 */

const LOOKBACK_MS = 24 * 60 * 60 * 1000;
// Timeouts should be ~0; a large cap only guards against a pathological runaway
// while still recording a definitive ">0" for the alert.
const MAX_COUNT = 1000;
const SCAN_FAILED = -1;

export type ObserveAgentTaskTimeoutsResult = {
  /** Number of timed-out agent tasks in the lookback window, or -1 if the scan failed. */
  timeouts: number;
};

async function countTimedOutAgentTasks(): Promise<number> {
  const client = await createTemporalClient();
  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
  const query = `WorkflowType = "agentTaskWorkflow" AND ExecutionStatus = "TimedOut" AND CloseTime > "${since}"`;

  let count = 0;
  for await (const _execution of client.workflow.list({ query })) {
    count += 1;
    if (count >= MAX_COUNT) {
      break;
    }
  }
  return count;
}

export async function runObserveAgentTaskTimeouts(): Promise<ObserveAgentTaskTimeoutsResult> {
  try {
    const count = await countTimedOutAgentTasks();
    agentTaskTimeouts24h.set(count);
    Context.current().heartbeat();
    return { timeouts: count };
  } catch (error: unknown) {
    // Non-fatal: record an explicit "scan failed" sentinel (alert on < 0) so a
    // broken scan is distinguishable from a clean "no timeouts" result, then
    // surface the error to Sentry.
    agentTaskTimeouts24h.set(SCAN_FAILED);
    Sentry.captureException(error);
    return { timeouts: SCAN_FAILED };
  }
}

export const observeAgentTaskTimeoutsActivities = {
  runObserveAgentTaskTimeouts,
};

export type ObserveAgentTaskTimeoutsActivities =
  typeof observeAgentTaskTimeoutsActivities;
