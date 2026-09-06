import { proxyActivities } from "@temporalio/workflow";
import type {
  ScoutQueueWindowsActivities,
  ScoutQueueWindowsResult,
} from "#activities/scout/scout-queue-windows.ts";
import type {
  ActivityReportInput,
  ReportDeliveryActivities,
} from "#activities/reports/report-delivery.ts";
import { SCOUT_QUEUE_WINDOWS_LOOKBACK_DAYS } from "#shared/scout-queue-windows-lookback.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { reportActivityTaskQueue } from "./report-activity-queue.ts";

const { refreshScoutQueueWindows } =
  proxyActivities<ScoutQueueWindowsActivities>({
    taskQueue: TASK_QUEUES.SCOUT,
    // Clones the monorepo, does the root + scout workspace installs, scans
    // the scout-prod match lake for the 28-day lookback, and opens a PR on
    // window drift (auto-merge for open/reopen edits only). Heartbeats fire
    // every 10s in the activity, so worker death surfaces in <60s. 30 min
    // leaves room for a retry inside the 45-min workflowExecutionTimeout.
    startToCloseTimeout: "30 minutes",
    heartbeatTimeout: "60 seconds",
    retry: {
      maximumAttempts: 2,
      initialInterval: "2 minutes",
      backoffCoefficient: 2,
      maximumInterval: "10 minutes",
    },
  });

type QueueReportState = {
  hasWarnings: boolean;
  changed: boolean;
  publicationFailed: boolean;
  autoMergeFailed: boolean;
};

function queueReportState(result: ScoutQueueWindowsResult): QueueReportState {
  const changed = result.outcome === "pr-created";
  return {
    changed,
    hasWarnings: result.warningCount > 0,
    publicationFailed: changed && result.prUrl === undefined,
    autoMergeFailed: result.autoMergeConfigured === false,
  };
}

function queueHeadline(
  result: ScoutQueueWindowsResult,
  state: QueueReportState,
): string {
  if (state.changed) {
    return `${result.editCount.toString()} queue-window edits published in ${result.prUrl ?? "an unknown PR"}.`;
  }
  if (state.hasWarnings) {
    return `${result.warningCount.toString()} warnings with fingerprint ${result.warningFingerprint ?? "unavailable"} (${result.warningConsecutiveRuns.toString()} consecutive runs).`;
  }
  return "Match evidence produced no queue-window changes or warnings.";
}

function queueChecks(
  result: ScoutQueueWindowsResult,
  state: QueueReportState,
): ActivityReportInput["checks"] {
  return [
    {
      id: "match-evidence",
      label: "Match-lake scan and deterministic diff",
      required: true,
      status: "passed",
      summary: `${result.editCount.toString()} edits and ${result.warningCount.toString()} warnings`,
      evidenceReceiptIds: ["queue-window-result"],
    },
    {
      id: "proposal-publication",
      label: "Proposal publication",
      required: state.changed,
      status: state.changed
        ? state.publicationFailed
          ? "failed"
          : "passed"
        : "skipped",
      summary: state.changed
        ? (result.prUrl ?? "PR URL missing")
        : "No proposal was needed",
      evidenceReceiptIds: state.changed ? ["proposal-publication"] : [],
    },
    {
      id: "auto-merge-configuration",
      label: "Auto-merge configuration",
      required: result.autoMergeRequested,
      status: result.autoMergeRequested
        ? state.autoMergeFailed
          ? "failed"
          : "passed"
        : "skipped",
      summary: result.autoMergeRequested
        ? state.autoMergeFailed
          ? "Auto-merge setup failed"
          : "Auto-merge enabled for additive edits"
        : "Human review retained for close edits or no change",
      evidenceReceiptIds: result.autoMergeRequested
        ? ["auto-merge-configuration"]
        : [],
    },
  ];
}

function queueEvidence(
  result: ScoutQueueWindowsResult,
  state: QueueReportState,
  observedAt: string,
): ActivityReportInput["evidence"] {
  const summary = [...result.editSummaries, ...result.warningSummaries].join(
    "\n",
  );
  return [
    {
      id: "queue-window-result",
      source: "scout-prod match lake and repository diff",
      observedAt,
      status: "success",
      ...(result.prUrl === undefined ? {} : { url: result.prUrl }),
      excerpt: summary === "" ? "No edits or warnings" : summary.slice(0, 2000),
    },
    ...(state.changed
      ? [
          {
            id: "proposal-publication",
            source: "GitHub pull request publication",
            observedAt,
            status: state.publicationFailed
              ? ("failure" as const)
              : ("success" as const),
            ...(result.prUrl === undefined ? {} : { url: result.prUrl }),
            excerpt: result.prUrl ?? "PR URL missing",
          },
        ]
      : []),
    ...(result.autoMergeRequested
      ? [
          {
            id: "auto-merge-configuration",
            source: "GitHub pull request auto-merge state",
            observedAt,
            status: state.autoMergeFailed
              ? ("failure" as const)
              : ("success" as const),
            ...(result.prUrl === undefined ? {} : { url: result.prUrl }),
            excerpt: state.autoMergeFailed
              ? "Auto-merge setup failed"
              : "Auto-merge enabled",
          },
        ]
      : []),
  ];
}

function failureReport(startedAt: string, error: unknown): ActivityReportInput {
  const message = error instanceof Error ? error.message : String(error);
  const observedAt = new Date().toISOString();
  return {
    reportType: "scout-queue-windows",
    title: "Scout queue windows",
    scheduleId: "scout-queue-windows-daily",
    startedAt,
    execution: "failed",
    verdict: "inconclusive",
    headline: "Queue-window collection failed; no clean conclusion was made.",
    checks: [
      {
        id: "queue-window-refresh",
        label: "Queue-window refresh",
        required: true,
        status: "failed",
        summary: message,
        evidenceReceiptIds: ["refresh-failure"],
      },
    ],
    evidence: [
      {
        id: "refresh-failure",
        source: "scout queue-window collector",
        observedAt,
        status: "failure",
        excerpt: message.slice(0, 2000),
      },
    ],
    findings: [],
    limitations: [
      "Match-lake evidence or repository validation did not complete.",
    ],
    actions: ["Inspect the failed activity and rerun the schedule."],
    provenance: {
      query: `scout-prod matches over the prior ${SCOUT_QUEUE_WINDOWS_LOOKBACK_DAYS.toString()} days`,
    },
  };
}

export function scoutQueueWindowsReport(
  startedAt: string,
  result: ScoutQueueWindowsResult,
): ActivityReportInput {
  const observedAt = new Date().toISOString();
  const state = queueReportState(result);
  return {
    reportType: "scout-queue-windows",
    title: "Scout queue windows",
    scheduleId: "scout-queue-windows-daily",
    startedAt,
    execution:
      state.autoMergeFailed || state.publicationFailed ? "partial" : "complete",
    verdict:
      state.hasWarnings || state.autoMergeFailed || state.publicationFailed
        ? "attention"
        : state.changed
          ? "changed"
          : "clear",
    headline: queueHeadline(result, state),
    checks: queueChecks(result, state),
    evidence: queueEvidence(result, state, observedAt),
    findings: [
      ...result.editSummaries.map((summary) => ({
        severity: "info" as const,
        summary,
        evidenceReceiptIds: ["queue-window-result"],
      })),
      ...result.warningSummaries.map((summary) => ({
        severity: "warning" as const,
        summary,
        detail: `fingerprint=${result.warningFingerprint ?? "unavailable"}; consecutiveRuns=${result.warningConsecutiveRuns.toString()}`,
        evidenceReceiptIds: ["queue-window-result"],
      })),
    ],
    limitations: [
      ...(state.publicationFailed
        ? ["The refresh reported a created proposal without a PR URL."]
        : []),
      ...(state.autoMergeFailed
        ? ["The proposal exists, but automatic merge could not be configured."]
        : []),
    ],
    actions: state.autoMergeFailed
      ? ["Review the proposal and configure or perform its merge manually."]
      : [],
    provenance: {
      source: "s3://scout-prod",
      query: `queue availability over the prior ${SCOUT_QUEUE_WINDOWS_LOOKBACK_DAYS.toString()} days`,
    },
  };
}

export async function runScoutQueueWindowsWatch(): Promise<ScoutQueueWindowsResult> {
  const { deliverActivityReport } = proxyActivities<ReportDeliveryActivities>({
    taskQueue: reportActivityTaskQueue(),
    startToCloseTimeout: "2 minutes",
    retry: { maximumAttempts: 3 },
  });
  const startedAt = new Date().toISOString();
  try {
    const result = await refreshScoutQueueWindows();
    await deliverActivityReport(scoutQueueWindowsReport(startedAt, result));
    return result;
  } catch (error) {
    await deliverActivityReport(failureReport(startedAt, error));
    throw error;
  }
}
