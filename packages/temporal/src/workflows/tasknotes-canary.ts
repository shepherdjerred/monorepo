import { proxyActivities } from "@temporalio/workflow";
import type {
  TasknotesCanaryActivities,
  TasknotesCanaryResult,
} from "#activities/tasknotes-canary.ts";
import type {
  ActivityReportInput,
  ReportDeliveryActivities,
} from "#activities/report-delivery.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { reportActivityTaskQueue } from "./report-activity-queue.ts";

const activities = proxyActivities<TasknotesCanaryActivities>({
  taskQueue: TASK_QUEUES.INFRA,
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 3 },
});
function taskCountDrop(result: TasknotesCanaryResult): number | undefined {
  if (result.baseline === undefined || result.baseline.tasks === 0) {
    return undefined;
  }
  return (result.baseline.tasks - result.engine.tasks) / result.baseline.tasks;
}

export function tasknotesReport(
  startedAt: string,
  result: TasknotesCanaryResult,
): ActivityReportInput {
  const unhealthyPods = result.pods.filter(
    (pod) =>
      pod.status.phase !== "Running" ||
      pod.status.containerStatuses.some((container) => !container.ready),
  );
  const taskDrop = taskCountDrop(result);
  const dropped = taskDrop !== undefined && taskDrop > 0.2;
  const skipped = result.engine.skippedFiles.length > 0;
  const baselineKnown = result.baseline !== undefined;
  return {
    reportType: "tasknotes-canary",
    title: "TaskNotes skipped-files canary",
    scheduleId: "tasknotes-skipped-files-canary",
    startedAt,
    execution: baselineKnown ? "complete" : "partial",
    verdict:
      skipped || dropped || unhealthyPods.length > 0
        ? "attention"
        : baselineKnown
          ? "clear"
          : "inconclusive",
    headline: `${result.engine.tasks.toString()} tasks; ${result.engine.skippedFiles.length.toString()} skipped files; ${unhealthyPods.length.toString()} unhealthy pods${baselineKnown ? "; accepted baseline compared" : "; accepted baseline not yet available"}.`,
    checks: [
      {
        id: "engine-status",
        label: "TaskNotes engine status",
        required: true,
        status: "passed",
        summary: `${result.engine.tasks.toString()} tasks and ${result.engine.skippedFiles.length.toString()} skipped files`,
        evidenceReceiptIds: ["engine-status"],
      },
      {
        id: "pod-health",
        label: "TaskNotes pod health",
        required: true,
        status: "passed",
        summary: `${unhealthyPods.length.toString()} unhealthy of ${result.pods.length.toString()} pods`,
        evidenceReceiptIds: ["pod-health"],
      },
      {
        id: "task-count",
        label: "Task count trend",
        required: true,
        status: baselineKnown ? "passed" : "skipped",
        summary:
          result.baseline === undefined
            ? "No prior accepted baseline; this count will become the baseline after delivery"
            : `${result.baseline.tasks.toString()} -> ${result.engine.tasks.toString()} (${((taskDrop ?? 0) * 100).toFixed(1)}% drop)`,
        evidenceReceiptIds: baselineKnown
          ? ["engine-status", "task-count-baseline"]
          : [],
      },
    ],
    evidence: [
      {
        id: "engine-status",
        source: "TaskNotes /api/engine-status via in-pod authenticated request",
        observedAt: result.observedAt,
        status: "success",
        command:
          "kubectl exec -n tasknotes deploy/tasknotes -c tasknotes-server -- bun -e <typed-fetch>",
        excerpt: JSON.stringify({
          tasks: result.engine.tasks,
          skippedFiles: result.engine.skippedFiles.length,
        }),
      },
      {
        id: "pod-health",
        source: "Kubernetes pods API",
        observedAt: result.observedAt,
        status: "success",
        command: "kubectl get pods -n tasknotes -o json",
        excerpt: result.evidence.pods.slice(0, 2000),
      },
      ...(result.baseline === undefined ||
      result.evidence.baseline === undefined
        ? []
        : [
            {
              id: "task-count-baseline",
              source: "Prior accepted TaskNotes canary report state",
              observedAt: result.baseline.acceptedAt,
              status: "success" as const,
              excerpt: result.evidence.baseline,
            },
          ]),
    ],
    findings: [
      ...result.engine.skippedFiles.map((file) => ({
        severity: "critical" as const,
        summary: `TaskNotes skipped ${file.path}`,
        detail: file.reason,
        evidenceReceiptIds: ["engine-status"],
      })),
      ...unhealthyPods.map((pod) => ({
        severity: "warning" as const,
        summary: `${pod.metadata.namespace}/${pod.metadata.name} is ${pod.status.phase}`,
        evidenceReceiptIds: ["pod-health"],
      })),
      ...(dropped
        ? [
            {
              severity: "critical" as const,
              summary: `Task count dropped ${(taskDrop * 100).toFixed(1)}% from the accepted baseline`,
              evidenceReceiptIds: ["engine-status", "task-count-baseline"],
            },
          ]
        : []),
    ],
    limitations: baselineKnown
      ? []
      : ["No prior accepted task-count baseline exists yet."],
    actions:
      skipped || dropped
        ? [
            "Use the TaskNotes skipped-files repair runbook before changing the baseline.",
          ]
        : [],
    provenance: {
      source: "TaskNotes engine status, Kubernetes, and accepted report state",
      query: "current engine and pod state versus prior accepted task count",
    },
  };
}

function failureReport(startedAt: string, error: unknown): ActivityReportInput {
  const message = error instanceof Error ? error.message : String(error);
  const observedAt = new Date().toISOString();
  return {
    reportType: "tasknotes-canary",
    title: "TaskNotes skipped-files canary",
    scheduleId: "tasknotes-skipped-files-canary",
    startedAt,
    execution: "failed",
    verdict: "inconclusive",
    headline: "TaskNotes canary evidence collection failed.",
    checks: [
      {
        id: "canary-run",
        label: "TaskNotes canary collection",
        required: true,
        status: "failed",
        summary: message,
        evidenceReceiptIds: ["canary-failure"],
      },
    ],
    evidence: [
      {
        id: "canary-failure",
        source: "TaskNotes canary workflow",
        observedAt,
        status: "failure",
        excerpt: message.slice(0, 2000),
      },
    ],
    findings: [],
    limitations: ["Engine, pod, or baseline evidence is incomplete."],
    actions: ["Inspect the failed activity and rerun the schedule."],
    provenance: { source: "TaskNotes canary workflow" },
  };
}

export async function runTasknotesCanary(): Promise<void> {
  const { deliverActivityReport } = proxyActivities<ReportDeliveryActivities>({
    taskQueue: reportActivityTaskQueue(),
    startToCloseTimeout: "2 minutes",
    retry: { maximumAttempts: 3 },
  });
  const startedAt = new Date().toISOString();
  try {
    const result = await activities.collectTasknotesCanary();
    await deliverActivityReport(tasknotesReport(startedAt, result));
  } catch (error) {
    await deliverActivityReport(failureReport(startedAt, error));
    throw error;
  }
}
