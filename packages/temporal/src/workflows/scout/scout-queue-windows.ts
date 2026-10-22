import { rethrowReportDeliveryFailure } from "#workflows/scout/report-delivery.ts";
import { proxyActivities } from "@temporalio/workflow";
import type {
  ScoutQueueWindowsActivities,
  ScoutQueueWindowsResult,
} from "#activities/scout/scout-queue-windows.ts";
import type { QueueLivenessCheck } from "#activities/scout/scout-queue-window-liveness.ts";
import type {
  ActivityReportInput,
  ReportDeliveryActivities,
} from "#activities/reports/report-delivery.ts";
import { SCOUT_QUEUE_WINDOWS_LOOKBACK_DAYS } from "#shared/scout-queue-windows-lookback.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { reportActivityTaskQueue } from "./report-activity-queue.ts";
import {
  REPORT_DELIVERY_ACTIVITY_RETRY,
  REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS,
} from "#shared/reports/report-delivery-policy.ts";

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
  /** Warnings that still escalate: every warning minus guarded `live` ones. */
  activeWarningCount: number;
  verifiedLiveCount: number;
  changed: boolean;
  publicationFailed: boolean;
  autoMergeFailed: boolean;
};

type QueueWarningFinding = { id?: string; summary: string };

function warningFindings(
  result: ScoutQueueWindowsResult,
): QueueWarningFinding[] {
  return (
    result.warningFindings ??
    result.warningSummaries.map((summary) => ({ summary }))
  );
}

function livenessCheckFor(
  result: ScoutQueueWindowsResult,
  finding: QueueWarningFinding,
): QueueLivenessCheck | undefined {
  // Findings without a stable identity cannot be matched to a check.
  return finding.id === undefined
    ? undefined
    : result.livenessChecks?.find((check) => check.findingId === finding.id);
}

function queueReportState(result: ScoutQueueWindowsResult): QueueReportState {
  const changed = result.outcome === "pr-created";
  const verifiedLiveCount = warningFindings(result).filter(
    (finding) => livenessCheckFor(result, finding)?.status === "live",
  ).length;
  const activeWarningCount = result.warningCount - verifiedLiveCount;
  return {
    changed,
    hasWarnings: activeWarningCount > 0,
    activeWarningCount,
    verifiedLiveCount,
    publicationFailed: changed && result.prUrl === undefined,
    autoMergeFailed: result.autoMergeConfigured === false,
  };
}

function verifiedLiveSuffix(state: QueueReportState): string {
  return state.verifiedLiveCount === 0
    ? ""
    : ` ${state.verifiedLiveCount.toString()} sparse ${state.verifiedLiveCount === 1 ? "queue was" : "queues were"} verified live by web search.`;
}

function queueHeadline(
  result: ScoutQueueWindowsResult,
  state: QueueReportState,
): string {
  if (state.changed) {
    return `${result.editCount.toString()} queue-window edits published in ${result.prUrl ?? "an unknown PR"}.`;
  }
  if (state.hasWarnings) {
    return `${state.activeWarningCount.toString()} warnings with fingerprint ${result.warningFingerprint ?? "unavailable"} (${result.warningConsecutiveRuns.toString()} consecutive runs).${verifiedLiveSuffix(state)}`;
  }
  return state.verifiedLiveCount > 0
    ? `Match evidence produced no queue-window changes.${verifiedLiveSuffix(state)}`
    : "Match evidence produced no queue-window changes or warnings.";
}

function livenessCounts(checks: readonly QueueLivenessCheck[]): {
  passed: number;
  problem: number;
  notChecked: number;
} {
  const notChecked = checks.filter(
    (check) => check.errorClass !== undefined,
  ).length;
  const passed = checks.filter((check) => check.status === "live").length;
  return { passed, problem: checks.length - passed - notChecked, notChecked };
}

/** Absent for results recorded before liveness checks, keeping replay output identical. */
function livenessCheck(
  checks: readonly QueueLivenessCheck[] | undefined,
): ActivityReportInput["checks"] {
  if (checks === undefined) return [];
  if (checks.length === 0) {
    return [
      {
        id: "queue-liveness",
        label: "Liveness verification (web search)",
        required: false,
        status: "skipped",
        summary: "No sparse queue warnings needed verification",
        evidenceReceiptIds: [],
      },
    ];
  }
  const counts = livenessCounts(checks);
  return [
    {
      id: "queue-liveness",
      label: "Liveness verification (web search)",
      required: false,
      status: counts.notChecked > 0 ? "failed" : "passed",
      summary: `Passed ${counts.passed.toString()} / Problem ${counts.problem.toString()} / Not checked ${counts.notChecked.toString()}`,
      evidenceReceiptIds: ["queue-liveness"],
    },
  ];
}

function livenessExcerpt(check: QueueLivenessCheck): string {
  const sources =
    check.sources.length === 0 ? "no sources" : check.sources.join(", ");
  const error = check.errorClass === undefined ? "" : ` [${check.errorClass}]`;
  const ended = check.endedOn === undefined ? "" : ` endedOn=${check.endedOn}`;
  return `${check.queue}: ${check.status}${error}${ended} - ${check.rationale} (${sources})`;
}

function livenessUsageLine(checks: readonly QueueLivenessCheck[]): string {
  const usage = checks.flatMap((check) =>
    check.usage === undefined ? [] : [check.usage],
  );
  const sum = (pick: (item: (typeof usage)[number]) => number) =>
    usage.reduce((total, item) => total + pick(item), 0);
  const priced = usage.every((item) => item.costUsd !== undefined);
  const cost = priced
    ? `$${sum((item) => item.costUsd ?? 0).toFixed(4)}`
    : `$${sum((item) => item.tokenCostUsd).toFixed(4)} for tokens; web-search fees unpriced`;
  return `LLM usage: ${sum((item) => item.inputTokens).toString()} input / ${sum((item) => item.outputTokens).toString()} output tokens, ${sum((item) => item.webSearchRequests).toString()} web searches, ${cost}`;
}

function livenessEvidence(
  checks: readonly QueueLivenessCheck[] | undefined,
  observedAt: string,
): ActivityReportInput["evidence"] {
  if (checks === undefined || checks.length === 0) return [];
  return [
    {
      id: "queue-liveness",
      source: "LLM web-search liveness verification",
      observedAt,
      status: checks.some((check) => check.errorClass !== undefined)
        ? "failure"
        : "success",
      excerpt: [
        livenessUsageLine(checks),
        ...checks.map((check) => livenessExcerpt(check)),
      ]
        .join("\n")
        .slice(0, 2000),
    },
  ];
}

function warningReportFinding(
  result: ScoutQueueWindowsResult,
  finding: QueueWarningFinding,
): ActivityReportInput["findings"][number] {
  const check = livenessCheckFor(result, finding);
  const streak = `fingerprint=${result.warningFingerprint ?? "unavailable"}; consecutiveRuns=${result.warningConsecutiveRuns.toString()}`;
  if (check === undefined) {
    return {
      ...finding,
      state: "active",
      severity: "warning",
      detail: streak,
      evidenceReceiptIds: ["queue-window-result"],
    };
  }
  const sources =
    check.sources.length === 0 ? "none" : check.sources.join(", ");
  if (check.status === "live") {
    // Same precedent as the homelab audit's long-running workflows: a
    // condition that needs no action stays visible without escalating.
    return {
      ...finding,
      state: "observing",
      severity: "info",
      detail: `Verified live by web search: ${check.rationale} Sources: ${sources}`,
      evidenceReceiptIds: ["queue-window-result", "queue-liveness"],
    };
  }
  const error = check.errorClass === undefined ? "" : ` (${check.errorClass})`;
  return {
    ...finding,
    state: "active",
    severity: "warning",
    detail: `${streak}; liveness=${check.status}${error}: ${check.rationale} Sources: ${sources}`,
    evidenceReceiptIds: ["queue-window-result", "queue-liveness"],
  };
}

function endedQueueActions(
  checks: readonly QueueLivenessCheck[] | undefined,
): string[] {
  return (checks ?? [])
    .filter((check) => check.status === "ended")
    .map(
      (check) =>
        `Set \`end\` for ${check.queue} in queue-windows.json (LLM cites ended ${check.endedOn ?? "on an unstated date"}: ${check.sources.length === 0 ? "no sources" : check.sources.join(", ")}).`,
    );
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
    ...livenessCheck(result.livenessChecks),
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
    ...livenessEvidence(result.livenessChecks, observedAt),
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
      ...warningFindings(result).map((finding) =>
        warningReportFinding(result, finding),
      ),
    ],
    limitations: [
      ...(state.publicationFailed
        ? ["The refresh reported a created proposal without a PR URL."]
        : []),
      ...(state.autoMergeFailed
        ? ["The proposal exists, but automatic merge could not be configured."]
        : []),
      ...((result.livenessChecks?.length ?? 0) > 0
        ? [
            "Sparse-queue liveness is model-assessed from web search; a verified-live queue is informational, not proof of match volume.",
          ]
        : []),
    ],
    actions: [
      ...(state.autoMergeFailed
        ? ["Review the proposal and configure or perform its merge manually."]
        : []),
      ...endedQueueActions(result.livenessChecks),
    ],
    provenance: {
      source: "s3://scout-prod",
      query: `queue availability over the prior ${SCOUT_QUEUE_WINDOWS_LOOKBACK_DAYS.toString()} days`,
    },
  };
}

export async function runScoutQueueWindowsWatch(): Promise<ScoutQueueWindowsResult> {
  const { deliverActivityReport } = proxyActivities<ReportDeliveryActivities>({
    taskQueue: reportActivityTaskQueue(),
    startToCloseTimeout: REPORT_DELIVERY_ACTIVITY_START_TO_CLOSE_MS,
    retry: REPORT_DELIVERY_ACTIVITY_RETRY,
  });
  const startedAt = new Date().toISOString();
  try {
    const result = await refreshScoutQueueWindows();
    await deliverActivityReport(scoutQueueWindowsReport(startedAt, result));
    return result;
  } catch (error) {
    rethrowReportDeliveryFailure(error);
    await deliverActivityReport(failureReport(startedAt, error));
    throw error;
  }
}
