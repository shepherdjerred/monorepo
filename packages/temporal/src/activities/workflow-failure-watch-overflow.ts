import type { AlertmanagerAlert } from "#lib/alertmanager.ts";
import type { FailedWorkflowExecution } from "#shared/workflow-failure-alert.ts";

export const MAX_DETAILED_FAILURE_ALERTS = 100;

export function buildWorkflowFailureOverflowAlert(
  executions: readonly FailedWorkflowExecution[],
  since: Date,
  now: Date,
  ttlMs: number,
): AlertmanagerAlert {
  const counts = new Map<string, number>();
  for (const execution of executions) {
    const key = `${execution.workflowType} / ${execution.status}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const countLines = [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key}: ${count.toString()}`)
    .join("\n");
  const omitted = executions.length;
  const description = [
    `${omitted.toString()} failed Temporal workflow executions were omitted after the ${MAX_DETAILED_FAILURE_ALERTS.toString()}-execution detail budget was consumed.`,
    `lookbackSince ${since.toISOString()}`,
    "Counts by workflow type / status:",
    countLines,
  ].join("\n");
  return {
    labels: {
      alertname: "TemporalWorkflowFailureOverflow",
      namespace: "temporal",
      severity: "critical",
    },
    annotations: {
      summary: `Temporal workflow failure detail limit exceeded: ${omitted.toString()} omitted`,
      description,
      message: description,
    },
    startsAt: since.toISOString(),
    endsAt: new Date(now.getTime() + ttlMs).toISOString(),
  };
}
