import type { AlertmanagerAlert } from "#lib/alertmanager.ts";
import type { FailedWorkflowExecution } from "#shared/workflow-failure-alert.ts";

export const MAX_DETAILED_FAILURE_ALERTS = 100;

export type WorkflowFailureOverflowSummary = {
  omitted: number;
  counts: Readonly<Record<string, number>>;
  newestOmittedCloseTime: Date;
};

export function addWorkflowFailureOverflowBatch(
  summary: WorkflowFailureOverflowSummary | undefined,
  executions: readonly FailedWorkflowExecution[],
): WorkflowFailureOverflowSummary {
  const counts = summary === undefined ? {} : { ...summary.counts };
  for (const execution of executions) {
    const key = `${execution.workflowType} / ${execution.status}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const firstCloseTime = executions[0]?.closeTime;
  if (firstCloseTime === undefined) {
    throw new Error("overflow batch must contain an execution");
  }
  let newestOmittedCloseTime =
    summary?.newestOmittedCloseTime ?? firstCloseTime;
  for (const execution of executions) {
    if (execution.closeTime > newestOmittedCloseTime) {
      newestOmittedCloseTime = execution.closeTime;
    }
  }
  return {
    omitted: (summary?.omitted ?? 0) + executions.length,
    counts,
    newestOmittedCloseTime,
  };
}

export function buildWorkflowFailureOverflowAlert(
  summary: WorkflowFailureOverflowSummary,
  since: Date,
  observedAt: Date,
  ttlMs: number,
): AlertmanagerAlert {
  const countLines = Object.entries(summary.counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key}: ${count.toString()}`)
    .join("\n");
  const description = [
    `${summary.omitted.toString()} failed Temporal workflow executions were omitted after the ${MAX_DETAILED_FAILURE_ALERTS.toString()}-execution detail budget was consumed.`,
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
      summary: `Temporal workflow failure detail limit exceeded: ${summary.omitted.toString()} omitted`,
      description,
      message: description,
    },
    startsAt: observedAt.toISOString(),
    endsAt: new Date(
      summary.newestOmittedCloseTime.getTime() + ttlMs,
    ).toISOString(),
  };
}
