import { proxyActivities } from "@temporalio/workflow";
import type {
  LanePriorActivities,
  LanePriorRefreshResult,
  LanePriorWorkflowInput,
} from "#activities/lane-prior-refresh.ts";
import type {
  ActivityReportInput,
  ReportDeliveryActivities,
} from "#activities/reports/report-delivery.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { reportActivityTaskQueue } from "./report-activity-queue.ts";

const { updateLanePriors } = proxyActivities<LanePriorActivities>({
  taskQueue: TASK_QUEUES.SCOUT,
  startToCloseTimeout: "90 minutes",
  heartbeatTimeout: "60 seconds",
  retry: {
    maximumAttempts: 2,
    initialInterval: "5 minutes",
    backoffCoefficient: 2,
    maximumInterval: "15 minutes",
  },
});

function evaluation(result: LanePriorRefreshResult): {
  changed: boolean;
  pending: boolean;
  publicationFailed: boolean;
  autoMergeFailed: boolean;
} {
  const publicationRequired =
    result.reason === "pr-created" || result.reason === "pr-already-open";
  return {
    changed: result.reason === "pr-created",
    pending: result.reason === "pr-already-open",
    publicationFailed: publicationRequired && result.prUrl === undefined,
    autoMergeFailed: result.autoMergeConfigured === false,
  };
}

function publicationEvidence(
  result: LanePriorRefreshResult,
  state: ReturnType<typeof evaluation>,
  attention: boolean,
): ActivityReportInput["evidence"][number] | undefined {
  if (!state.changed && !state.pending) return undefined;
  return {
    id: "proposal-publication",
    source: "GitHub pull request publication and auto-merge state",
    observedAt: new Date().toISOString(),
    status: attention ? "failure" : "success",
    ...(result.prUrl === undefined ? {} : { url: result.prUrl }),
    excerpt: result.prUrl ?? "PR URL missing",
  };
}

function publicationStatus(
  state: ReturnType<typeof evaluation>,
): ActivityReportInput["checks"][number]["status"] {
  if (state.publicationFailed || state.autoMergeFailed) return "failed";
  if (state.changed || state.pending) return "passed";
  return "skipped";
}

function reportVerdict(
  state: ReturnType<typeof evaluation>,
): ActivityReportInput["verdict"] {
  if (state.publicationFailed || state.autoMergeFailed) return "attention";
  if (state.changed) return "changed";
  if (state.pending) return "pending";
  return "clear";
}

function reportChecks(
  result: LanePriorRefreshResult,
  state: ReturnType<typeof evaluation>,
): ActivityReportInput["checks"] {
  const publicationRequired = state.changed || state.pending;
  return [
    {
      id: "lane-prior-refresh",
      label: "Lane-prior generation and evaluation",
      required: true,
      status: "passed",
      summary: `${String(result.changedFiles.length)} changed files`,
      evidenceReceiptIds: ["refresh-result"],
    },
    {
      id: "proposal-publication",
      label: "PR publication and auto-merge",
      required: publicationRequired,
      status: publicationStatus(state),
      summary: result.prUrl ?? "No PR required",
      evidenceReceiptIds: publicationRequired ? ["proposal-publication"] : [],
    },
  ];
}

function reportEvidence(
  result: LanePriorRefreshResult,
  state: ReturnType<typeof evaluation>,
  attention: boolean,
): ActivityReportInput["evidence"] {
  const publication = publicationEvidence(result, state, attention);
  return [
    {
      id: "refresh-result",
      source: "Lane-prior generator, evaluation, preflight, and git diff",
      observedAt: new Date().toISOString(),
      status: "success",
      excerpt: `${result.reason}; files=${result.changedFiles.join(", ") || "none"}`,
    },
    ...(publication === undefined ? [] : [publication]),
  ];
}

function reportFindings(
  result: LanePriorRefreshResult,
  state: ReturnType<typeof evaluation>,
): ActivityReportInput["findings"] {
  if (!state.publicationFailed && !state.autoMergeFailed) return [];
  return [
    {
      severity: "warning",
      summary: "Lane-prior PR publication needs attention",
      ...(result.prUrl === undefined ? {} : { detail: result.prUrl }),
      evidenceReceiptIds: ["refresh-result"],
    },
  ];
}

function report(
  startedAt: string,
  result: LanePriorRefreshResult,
): ActivityReportInput {
  const state = evaluation(result);
  const attention = state.publicationFailed || state.autoMergeFailed;
  return {
    reportType: "scout-lane-priors",
    title: "Scout lane-prior refresh",
    scheduleId: "scout-lane-priors-weekly-refresh",
    startedAt,
    execution: attention ? "partial" : "complete",
    verdict: reportVerdict(state),
    headline: `${result.reason}; ${String(result.changedFiles.length)} files changed${result.contentHash === undefined ? "" : `; hash=${result.contentHash}`}.`,
    checks: reportChecks(result, state),
    evidence: reportEvidence(result, state, attention),
    findings: reportFindings(result, state),
    limitations: state.autoMergeFailed
      ? ["The PR exists, but automatic merge could not be configured."]
      : [],
    actions: state.autoMergeFailed
      ? ["Review and merge the lane-prior PR manually when green."]
      : [],
    provenance: {
      source: "Scout lane-prior artifacts and evaluation report",
      query: "weekly-refresh",
    },
  };
}

function failureReport(startedAt: string, error: unknown): ActivityReportInput {
  const message = error instanceof Error ? error.message : String(error);
  return {
    reportType: "scout-lane-priors",
    title: "Scout lane-prior refresh",
    scheduleId: "scout-lane-priors-weekly-refresh",
    startedAt,
    execution: "failed",
    verdict: "inconclusive",
    headline: "Lane-prior automation failed; no clean conclusion was made.",
    checks: [
      {
        id: "lane-prior-refresh",
        label: "Lane-prior generation and evaluation",
        required: true,
        status: "failed",
        summary: message,
        evidenceReceiptIds: ["run-failure"],
      },
    ],
    evidence: [
      {
        id: "run-failure",
        source: "Scout lane-prior workflow",
        observedAt: new Date().toISOString(),
        status: "failure",
        excerpt: message.slice(0, 2000),
      },
    ],
    findings: [],
    limitations: ["Lane-prior generation, validation, or publication failed."],
    actions: ["Inspect the failed activity and rerun the schedule."],
    provenance: {
      source: "Scout lane-prior automation",
      query: "weekly-refresh",
    },
  };
}

export async function runScoutLanePriorsWeeklyRefresh(
  input: LanePriorWorkflowInput,
  reportTaskQueue?: string,
): Promise<LanePriorRefreshResult> {
  const { deliverActivityReport } = proxyActivities<ReportDeliveryActivities>({
    taskQueue: reportActivityTaskQueue(reportTaskQueue),
    startToCloseTimeout: "2 minutes",
    retry: { maximumAttempts: 3 },
  });
  const startedAt = new Date().toISOString();
  try {
    const result = await updateLanePriors(input);
    await deliverActivityReport(report(startedAt, result));
    return result;
  } catch (error: unknown) {
    await deliverActivityReport(failureReport(startedAt, error));
    throw error;
  }
}
