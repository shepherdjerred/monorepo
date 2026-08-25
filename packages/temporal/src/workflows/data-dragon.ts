import { patched, proxyActivities } from "@temporalio/workflow";
import type { DataDragonActivities } from "#activities/data-dragon.ts";
import type {
  DataDragonVersionState,
  DataDragonUpdateMode,
  DataDragonUpdateResult,
} from "#shared/data-dragon-types.ts";
import {
  resolveTerminalFailureReason,
  UPDATE_DATA_DRAGON_MAX_ATTEMPTS,
} from "#shared/data-dragon-util.ts";
import type {
  ActivityReportInput,
  ReportDeliveryActivities,
} from "#activities/report-delivery.ts";
import { reportActivityTaskQueue } from "./report-activity-queue.ts";

const {
  getDataDragonVersionState,
  recordDataDragonSkipped,
  recordDataDragonFailure,
} = proxyActivities<DataDragonActivities>({
  startToCloseTimeout: "1 minute",
  retry: {
    maximumAttempts: 3,
    initialInterval: "30 seconds",
    backoffCoefficient: 2,
    maximumInterval: "2 minutes",
  },
});

const { updateDataDragon } = proxyActivities<DataDragonActivities>({
  startToCloseTimeout: "90 minutes",
  heartbeatTimeout: "60 seconds",
  retry: {
    maximumAttempts: UPDATE_DATA_DRAGON_MAX_ATTEMPTS,
    initialInterval: "5 minutes",
    backoffCoefficient: 2,
    maximumInterval: "15 minutes",
  },
});

function stateEvidence(
  state: DataDragonVersionState,
  observedAt: string,
): ActivityReportInput["evidence"][number] {
  return {
    id: "version-state",
    source: "Data Dragon versions API and repository version.json",
    observedAt,
    status: "success",
    excerpt: `current=${state.currentVersion}; latest=${state.latestVersion}; updateRequired=${String(state.updateRequired)}`,
  };
}

type DataDragonEvaluation = {
  reason: string;
  changed: boolean;
  pending: boolean;
  attention: boolean;
  publicationRequired: boolean;
  publicationFailed: boolean;
  autoMergeFailed: boolean;
};

function evaluateDataDragon(
  result: DataDragonUpdateResult | undefined,
): DataDragonEvaluation {
  const reason = result?.reason ?? "version-current";
  const changed = reason === "pr-created";
  const pending = reason === "pr-already-open";
  const publicationRequired = changed || pending;
  return {
    reason,
    changed,
    pending,
    attention: reason === "image-only-diff",
    publicationRequired,
    publicationFailed: publicationRequired && result?.prUrl === undefined,
    autoMergeFailed: result?.autoMergeConfigured === false,
  };
}

function dataDragonScheduleId(mode: DataDragonUpdateMode): string {
  return mode === "version-check"
    ? "scout-data-dragon-version-check"
    : "scout-data-dragon-weekly-refresh";
}

function dataDragonVerdict(
  state: DataDragonEvaluation,
): ActivityReportInput["verdict"] {
  if (state.autoMergeFailed || state.publicationFailed || state.attention) {
    return "attention";
  }
  if (state.changed) return "changed";
  return state.pending ? "pending" : "clear";
}

function dataDragonChecks(
  state: DataDragonVersionState,
  result: DataDragonUpdateResult | undefined,
  evaluation: DataDragonEvaluation,
): ActivityReportInput["checks"] {
  const refreshAttempted = result !== undefined;
  return [
    {
      id: "version-source",
      label: "Version source comparison",
      required: true,
      status: "passed",
      summary: `${state.currentVersion} vs ${state.latestVersion}`,
      evidenceReceiptIds: ["version-state"],
    },
    {
      id: "deterministic-refresh",
      label: "Generated asset diff and validation",
      required: refreshAttempted,
      status: refreshAttempted ? "passed" : "skipped",
      summary:
        result === undefined
          ? "Refresh not required for the version-check run"
          : `${result.changedFiles.length.toString()} changed files; ${evaluation.reason}`,
      evidenceReceiptIds: refreshAttempted ? ["refresh-result"] : [],
    },
    {
      id: "proposal-publication",
      label: "PR publication and auto-merge",
      required: evaluation.publicationRequired,
      status: evaluation.publicationRequired
        ? evaluation.publicationFailed || evaluation.autoMergeFailed
          ? "failed"
          : "passed"
        : "skipped",
      summary: evaluation.publicationRequired
        ? `${result?.prUrl ?? "PR URL missing"}; autoMerge=${String(result?.autoMergeConfigured)}`
        : "No PR was required",
      evidenceReceiptIds: evaluation.publicationRequired
        ? ["proposal-publication"]
        : [],
    },
  ];
}

function dataDragonEvidence(
  state: DataDragonVersionState,
  result: DataDragonUpdateResult | undefined,
  evaluation: DataDragonEvaluation,
  observedAt: string,
): ActivityReportInput["evidence"] {
  if (result === undefined) return [stateEvidence(state, observedAt)];
  const refresh: ActivityReportInput["evidence"][number] = {
    id: "refresh-result",
    source: "Data Dragon update command, snapshots, and git diff",
    observedAt,
    status: "success",
    ...(result.prUrl === undefined ? {} : { url: result.prUrl }),
    excerpt:
      `${evaluation.reason}; files=${result.changedFiles.join(", ") || "none"}`.slice(
        0,
        2000,
      ),
  };
  if (!evaluation.publicationRequired) {
    return [stateEvidence(state, observedAt), refresh];
  }
  return [
    stateEvidence(state, observedAt),
    refresh,
    {
      id: "proposal-publication",
      source: "GitHub pull request publication and auto-merge state",
      observedAt,
      status:
        evaluation.publicationFailed || evaluation.autoMergeFailed
          ? "failure"
          : "success",
      ...(result.prUrl === undefined ? {} : { url: result.prUrl }),
      excerpt: `${result.prUrl ?? "PR URL missing"}; autoMerge=${String(result.autoMergeConfigured)}`,
    },
  ];
}

function dataDragonLimitations(evaluation: DataDragonEvaluation): string[] {
  return [
    ...(evaluation.attention
      ? ["Only generated image assets changed, so no proposal was opened."]
      : []),
    ...(evaluation.autoMergeFailed
      ? ["The PR exists, but automatic merge could not be configured."]
      : []),
    ...(evaluation.publicationFailed
      ? ["The expected PR URL is missing."]
      : []),
  ];
}

export function dataDragonReport(
  startedAt: string,
  mode: DataDragonUpdateMode,
  state: DataDragonVersionState,
  result: DataDragonUpdateResult | undefined,
): ActivityReportInput {
  const observedAt = new Date().toISOString();
  const evaluation = evaluateDataDragon(result);
  return {
    reportType: "scout-data-dragon",
    title: `Scout Data Dragon ${mode}`,
    scheduleId: dataDragonScheduleId(mode),
    startedAt,
    execution:
      evaluation.autoMergeFailed || evaluation.publicationFailed
        ? "partial"
        : "complete",
    verdict: dataDragonVerdict(evaluation),
    headline:
      result === undefined
        ? `Data Dragon is current at ${state.currentVersion}.`
        : `${evaluation.reason}: ${state.currentVersion} -> ${state.latestVersion}; ${result.changedFiles.length.toString()} files changed.`,
    checks: dataDragonChecks(state, result, evaluation),
    evidence: dataDragonEvidence(state, result, evaluation, observedAt),
    findings:
      result === undefined
        ? []
        : [
            {
              severity:
                evaluation.attention || evaluation.autoMergeFailed
                  ? "warning"
                  : "info",
              summary: `${evaluation.reason}: ${result.changedFiles.length.toString()} changed files`,
              ...(result.prUrl === undefined ? {} : { detail: result.prUrl }),
              evidenceReceiptIds: ["refresh-result"],
            },
          ],
    limitations: dataDragonLimitations(evaluation),
    actions: evaluation.autoMergeFailed
      ? ["Review the open Data Dragon PR and merge it manually when green."]
      : [],
    provenance: {
      source: "ddragon.leagueoflegends.com and shepherdjerred/monorepo",
      query: mode,
    },
  };
}

function failureReport(
  startedAt: string,
  mode: DataDragonUpdateMode,
  error: unknown,
  state: DataDragonVersionState | undefined,
): ActivityReportInput {
  const message = error instanceof Error ? error.message : String(error);
  const observedAt = new Date().toISOString();
  return {
    reportType: "scout-data-dragon",
    title: `Scout Data Dragon ${mode}`,
    scheduleId:
      mode === "version-check"
        ? "scout-data-dragon-version-check"
        : "scout-data-dragon-weekly-refresh",
    startedAt,
    execution: "failed",
    verdict: "inconclusive",
    headline: "Data Dragon automation failed; no clean conclusion was made.",
    checks: [
      {
        id: "data-dragon-run",
        label: "Version collection and deterministic refresh",
        required: true,
        status: "failed",
        summary: message,
        evidenceReceiptIds: ["run-failure"],
      },
    ],
    evidence: [
      {
        id: "run-failure",
        source: "Data Dragon workflow",
        observedAt,
        status: "failure",
        excerpt: [
          message,
          state === undefined
            ? "version state unavailable"
            : `current=${state.currentVersion}; latest=${state.latestVersion}`,
        ]
          .join("; ")
          .slice(0, 2000),
      },
    ],
    findings: [],
    limitations: [
      "Version collection, validation, or publication did not complete.",
    ],
    actions: ["Inspect the failed activity and rerun the schedule."],
    provenance: { source: "Scout Data Dragon automation", query: mode },
  };
}

export async function runScoutDataDragonUpdate(
  mode: DataDragonUpdateMode,
  reportTaskQueue?: string,
): Promise<DataDragonUpdateResult | undefined> {
  const { deliverActivityReport } = proxyActivities<ReportDeliveryActivities>({
    taskQueue: reportActivityTaskQueue(reportTaskQueue),
    startToCloseTimeout: "2 minutes",
    retry: { maximumAttempts: 3 },
  });
  const startedAt = new Date().toISOString();
  let state: DataDragonVersionState | undefined;
  let result: DataDragonUpdateResult | undefined;
  let report: ActivityReportInput;
  // Only collection and the update itself belong in this catch. Report
  // delivery runs after it, so a Postal/S3 outage cannot record a
  // `scout_data_dragon_runs{outcome="failed"}` sample (and fire
  // ScoutDataDragonUpdateFailed) for a run whose updater actually succeeded.
  try {
    state = await getDataDragonVersionState();
    if (mode === "version-check" && !state.updateRequired) {
      await recordDataDragonSkipped({
        ...state,
        mode,
        reason: "version-current",
      });
      report = dataDragonReport(startedAt, mode, state, undefined);
    } else {
      result = await updateDataDragon({
        ...state,
        mode,
      });
      report = dataDragonReport(startedAt, mode, state, result);
    }
  } catch (error) {
    if (
      state !== undefined &&
      patched("data-dragon-workflow-record-terminal-failure")
    ) {
      await recordDataDragonFailure({
        ...state,
        mode,
        reason: resolveTerminalFailureReason(error),
      });
    }
    if (patched("data-dragon-report-envelope-v1")) {
      await deliverActivityReport(failureReport(startedAt, mode, error, state));
    }
    throw error;
  }

  if (patched("data-dragon-report-envelope-v1")) {
    await deliverActivityReport(report);
  }
  return result;
}
