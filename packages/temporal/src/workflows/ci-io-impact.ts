import { proxyActivities } from "@temporalio/workflow";
import type {
  CiIoImpactActivities,
  CiIoImpactResult,
} from "#activities/ci-io-impact.ts";
import type {
  ActivityReportInput,
  ReportDeliveryActivities,
} from "#activities/report-delivery.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const { collectCiIoImpact } = proxyActivities<CiIoImpactActivities>({
  startToCloseTimeout: "45 minutes",
  retry: { maximumAttempts: 2 },
});
const { deliverActivityReport } = proxyActivities<ReportDeliveryActivities>({
  taskQueue: TASK_QUEUES.REPORTS,
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 3 },
});

type CiIoEvaluation = {
  pending: boolean;
  pendingReason: string | undefined;
  gate:
    | NonNullable<
        NonNullable<CiIoImpactResult["raw"]>["comparison"]
      >["fixedCorpusGate"]
    | undefined;
  rawPassed: boolean;
  recordingPassed: boolean;
  observabilityPassed: boolean;
  gateAvailable: boolean;
  gatePassed: boolean;
  complete: boolean;
  completedObservation: boolean;
};

function evaluateCiIo(result: CiIoImpactResult): CiIoEvaluation {
  const pendingReason = result.pendingReason;
  const pending = pendingReason !== undefined;
  const gate = result.raw?.comparison?.fixedCorpusGate;
  const rawPassed =
    result.raw !== undefined &&
    (result.rawExitCode === 0 ||
      result.rawError?.includes(
        "CI I/O fixed-corpus impact gate did not pass",
      ) === true);
  const recordingPassed =
    result.recordingExitCode === 0 && result.recording !== undefined;
  const observabilityPassed =
    result.observability.length > 0 &&
    result.observability.every((item) => item.passed);
  const gateAvailable = gate !== undefined;
  return {
    pending,
    pendingReason,
    gate,
    rawPassed,
    recordingPassed,
    observabilityPassed,
    gateAvailable,
    gatePassed: gate?.status === "passed",
    complete:
      pending ||
      (rawPassed && recordingPassed && observabilityPassed && gateAvailable),
    completedObservation:
      result.elapsedHours >= 168 && result.postMergeBuildCount >= 100,
  };
}

function ciIoChecks(
  result: CiIoImpactResult,
  state: CiIoEvaluation,
): ActivityReportInput["checks"] {
  return [
    {
      id: "merge-window",
      label: "Merge state and observation window",
      required: true,
      status: "passed",
      summary: `PR #1602 merged ${result.mergedAt}; ${result.elapsedHours.toFixed(1)} hours and ${result.postMergeBuildCount.toString()} finished builds observed`,
      evidenceReceiptIds: ["merge-window"],
    },
    ciIoRawCheck(result, state),
    ciIoRecordingCheck(result, state),
    ciIoObservabilityCheck(result, state),
    ciIoAcceptanceCheck(state),
  ];
}

function conditionalCheckStatus(
  pending: boolean,
  passed: boolean,
): "skipped" | "passed" | "failed" {
  if (pending) return "skipped";
  return passed ? "passed" : "failed";
}

function ciIoRawCheck(
  result: CiIoImpactResult,
  state: CiIoEvaluation,
): ActivityReportInput["checks"][number] {
  return {
    id: "raw-report",
    label: "Strict raw CI I/O report",
    required: !state.pending,
    status: conditionalCheckStatus(state.pending, state.rawPassed),
    summary: state.pending
      ? "Awaiting fixed-corpus candidate"
      : (result.rawError ??
        `schema-v4 raw report; gate ${state.gate?.status ?? "missing"}`),
    evidenceReceiptIds: state.pending ? [] : ["raw-report"],
  };
}

function ciIoRecordingCheck(
  result: CiIoImpactResult,
  state: CiIoEvaluation,
): ActivityReportInput["checks"][number] {
  return {
    id: "recording-report",
    label: "Recording-rule canary",
    required: !state.pending,
    status: conditionalCheckStatus(state.pending, state.recordingPassed),
    summary: state.pending
      ? "Awaiting fixed-corpus candidate"
      : (result.recordingError ?? "schema-v4 recording report passed"),
    evidenceReceiptIds: state.pending ? [] : ["recording-report"],
  };
}

function ciIoObservabilityCheck(
  result: CiIoImpactResult,
  state: CiIoEvaluation,
): ActivityReportInput["checks"][number] {
  const passed = result.observability.filter((item) => item.passed).length;
  return {
    id: "observability-health",
    label: "CI I/O observability health",
    required: !state.pending,
    status: conditionalCheckStatus(state.pending, state.observabilityPassed),
    summary: state.pending
      ? "Awaiting observation window"
      : `${passed.toString()} of ${result.observability.length.toString()} observability checks met their evidence and threshold requirements`,
    evidenceReceiptIds: state.pending ? [] : ["observability-health"],
  };
}

function ciIoAcceptanceCheck(
  state: CiIoEvaluation,
): ActivityReportInput["checks"][number] {
  return {
    id: "acceptance-gates",
    label: "Documented acceptance gates",
    required: !state.pending,
    status: conditionalCheckStatus(state.pending, state.gatePassed),
    summary: state.pending
      ? "Awaiting fixed-corpus candidate"
      : `write reduction ${state.gate?.aggregateWriteReductionPercent?.toFixed(1) ?? "unknown"}%; p95 duration ${state.gate?.p95DurationChangePercent?.toFixed(1) ?? "unknown"}%`,
    evidenceReceiptIds: state.pending ? [] : ["raw-report"],
  };
}

function ciIoEvidence(
  result: CiIoImpactResult,
  state: CiIoEvaluation,
): ActivityReportInput["evidence"] {
  const mergeEvidence: ActivityReportInput["evidence"][number] = {
    id: "merge-window",
    source: "GitHub PR API and Buildkite main-build API",
    observedAt: result.observedAt,
    status: "success",
    url: result.prUrl,
    excerpt: JSON.stringify({
      mergedAt: result.mergedAt,
      mergeSha: result.mergeSha,
      elapsedHours: result.elapsedHours,
      postMergeBuildCount: result.postMergeBuildCount,
      candidateBuilds: result.candidateBuilds,
    }),
  };
  if (state.pending) return [mergeEvidence];
  return [
    mergeEvidence,
    {
      id: "raw-report",
      source: "Repository schema-v4 CI I/O reporter in strict raw mode",
      observedAt: result.observedAt,
      status: state.rawPassed ? "success" : "failure",
      excerpt: (result.rawError ?? JSON.stringify(result.raw)).slice(0, 2000),
    },
    {
      id: "recording-report",
      source: "Repository schema-v4 CI I/O reporter in strict recording mode",
      observedAt: result.observedAt,
      status: state.recordingPassed ? "success" : "failure",
      excerpt: (
        result.recordingError ?? JSON.stringify(result.recording)
      ).slice(0, 2000),
    },
    {
      id: "observability-health",
      source: "Prometheus instant query API",
      observedAt: result.observedAt,
      status: state.observabilityPassed ? "success" : "failure",
      excerpt: JSON.stringify(result.observability).slice(0, 2000),
    },
  ];
}

function ciIoLimitations(state: CiIoEvaluation): string[] {
  return [
    ...(state.pendingReason === undefined ? [] : [state.pendingReason]),
    ...(!state.pending && !state.rawPassed
      ? ["Strict raw report did not pass."]
      : []),
    ...(!state.pending && !state.recordingPassed
      ? ["Strict recording-rule canary did not pass."]
      : []),
    ...(!state.pending && !state.observabilityPassed
      ? [
          "One or more observability checks lacked data or exceeded a required threshold.",
        ]
      : []),
  ];
}

function ciIoVerdict(state: CiIoEvaluation): ActivityReportInput["verdict"] {
  if (state.pending) return "pending";
  return state.complete && state.gatePassed ? "clear" : "attention";
}

function ciIoHeadline(state: CiIoEvaluation): string {
  if (state.pending) {
    return state.pendingReason ?? "CI I/O evaluation is pending.";
  }
  return `Fixed-corpus gate ${state.gate?.status ?? "unavailable"}; raw report ${state.rawPassed ? "passed" : "failed"}; recording canary ${state.recordingPassed ? "passed" : "failed"}; observability ${state.observabilityPassed ? "passed" : "failed"}.`;
}

export function ciIoImpactReport(
  startedAt: string,
  result: CiIoImpactResult,
): ActivityReportInput {
  const state = evaluateCiIo(result);
  const observedAt = result.observedAt;
  return {
    reportType: "ci-io-impact",
    title: "CI I/O optimization impact",
    scheduleId: "ci-io-post-merge-impact",
    startedAt,
    execution: state.complete ? "complete" : "partial",
    verdict: ciIoVerdict(state),
    headline: ciIoHeadline(state),
    checks: ciIoChecks(result, state),
    evidence: ciIoEvidence(result, state),
    findings:
      state.pending || state.gatePassed
        ? []
        : [
            {
              severity: "warning",
              summary: `CI I/O acceptance gate is ${state.gate?.status ?? "unavailable"}`,
              detail:
                state.gate?.reasons.join("; ") ??
                "Required evidence is incomplete.",
              evidenceReceiptIds: ["raw-report"],
            },
          ],
    limitations: ciIoLimitations(state),
    actions:
      state.pending || state.gatePassed
        ? []
        : [
            "Inspect the schema-v4 integrity findings and acceptance-gate reasons.",
          ],
    ...(state.completedObservation && state.complete && state.gatePassed
      ? {
          retirementRecommendation:
            "The seven-day and 100-build observation thresholds are complete; a human may retire this schedule after accepting the evidence.",
        }
      : {}),
    provenance: {
      source: "GitHub, Buildkite, Prometheus, and schema-v4 CI I/O reporter",
      windowStart: result.mergedAt,
      windowEnd: observedAt,
      query:
        "frozen 2026-07-19 pre-change cohort versus exact CI_IO_FIXED_CORPUS main builds",
      repoSha: result.mergeSha,
    },
  };
}

function failureReport(startedAt: string, error: unknown): ActivityReportInput {
  const message = error instanceof Error ? error.message : String(error);
  const observedAt = new Date().toISOString();
  return {
    reportType: "ci-io-impact",
    title: "CI I/O optimization impact",
    scheduleId: "ci-io-post-merge-impact",
    startedAt,
    execution: "failed",
    verdict: "inconclusive",
    headline: "CI I/O evidence collection failed.",
    checks: [
      {
        id: "ci-io-run",
        label: "CI I/O collection",
        required: true,
        status: "failed",
        summary: message,
        evidenceReceiptIds: ["ci-io-failure"],
      },
    ],
    evidence: [
      {
        id: "ci-io-failure",
        source: "CI I/O workflow",
        observedAt,
        status: "failure",
        excerpt: message.slice(0, 2000),
      },
    ],
    findings: [],
    limitations: ["Merge, reporter, or observability evidence is incomplete."],
    actions: ["Inspect the failed activity and rerun the schedule."],
    provenance: { source: "CI I/O workflow" },
  };
}

export async function runCiIoImpact(): Promise<void> {
  const startedAt = new Date().toISOString();
  try {
    await deliverActivityReport(
      ciIoImpactReport(startedAt, await collectCiIoImpact()),
    );
  } catch (error) {
    await deliverActivityReport(failureReport(startedAt, error));
    throw error;
  }
}
