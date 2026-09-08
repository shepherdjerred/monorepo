import type {
  IntegrityIssueCode,
  WindowIoReport,
} from "./ci-io-report-model.ts";

export type FixedCorpusProofKind = "exact" | "baseline-lower-bound" | null;

export function reductionPercent(change: number | null): number | null {
  if (change === null || change === 0) {
    return change;
  }
  return -change;
}

const BASELINE_LOWER_BOUND_ISSUE_CODES: ReadonlySet<IntegrityIssueCode> =
  new Set([
    "insufficient-long-job-samples",
    "missing-long-job-measurement",
    "missing-post-finish-parent-sample",
  ]);

function hasCompleteTelemetry(report: WindowIoReport): boolean {
  return (
    report.summary.expectedJobCount > 0 &&
    report.summary.completeJobCount === report.summary.expectedJobCount &&
    report.summary.measuredJobCount === report.summary.expectedJobCount &&
    report.integrityIssues.length === 0
  );
}

export function uniqueIssueCodes(report: WindowIoReport): IntegrityIssueCode[] {
  return [...new Set(report.integrityIssues.map((issue) => issue.code))].sort();
}

function baselineProofKind(
  baseline: WindowIoReport,
  reasons: string[],
): FixedCorpusProofKind {
  if (baseline.unfinishedBuilds.length > 0) {
    reasons.push("baseline fixed-corpus cohort excluded unfinished builds");
    return null;
  }
  if (hasCompleteTelemetry(baseline)) {
    return "exact";
  }
  const issueCodes = uniqueIssueCodes(baseline);
  const disallowedIssueCodes = issueCodes.filter(
    (code) => !BASELINE_LOWER_BOUND_ISSUE_CODES.has(code),
  );
  if (disallowedIssueCodes.length > 0) {
    reasons.push(
      `baseline fixed-corpus telemetry has inadmissible integrity issues: ${disallowedIssueCodes.join(", ")}`,
    );
    return null;
  }
  if (
    issueCodes.length === 0 ||
    (baseline.summary.lowerBoundJobCount === 0 &&
      baseline.summary.missingJobCount === 0)
  ) {
    reasons.push(
      "baseline fixed-corpus telemetry is incomplete without an admissible sampling issue",
    );
    return null;
  }
  return "baseline-lower-bound";
}

export function fixedCorpusTelemetryProof(
  baseline: WindowIoReport,
  candidate: WindowIoReport,
): {
  proofKind: FixedCorpusProofKind;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (candidate.unfinishedBuilds.length > 0) {
    reasons.push("candidate fixed-corpus cohort excluded unfinished builds");
  }
  if (!hasCompleteTelemetry(candidate)) {
    reasons.push(
      "candidate fixed-corpus window does not have complete telemetry",
    );
  }
  const proofKind = baselineProofKind(baseline, reasons);
  return {
    proofKind: reasons.length === 0 ? proofKind : null,
    reasons,
  };
}
