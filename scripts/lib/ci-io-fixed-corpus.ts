import type {
  FixedCorpusGate,
  FixedCorpusLane,
  WindowIoReport,
} from "./ci-io-report-model.ts";

function percentChange(candidate: number, baseline: number): number | null {
  if (baseline === 0) {
    return null;
  }
  return ((candidate - baseline) / baseline) * 100;
}

function lanes(report: WindowIoReport): FixedCorpusLane[] {
  return report.branchSteps
    .map((lane) => ({
      branch: lane.branch,
      stepKey: lane.stepKey,
      jobCount: lane.jobCount,
    }))
    .sort(
      (left, right) =>
        left.branch.localeCompare(right.branch) ||
        left.stepKey.localeCompare(right.stepKey),
    );
}

function laneKey(lane: FixedCorpusLane): string {
  return JSON.stringify([lane.branch, lane.stepKey]);
}

function exactLanePresence(
  baseline: FixedCorpusLane[],
  candidate: FixedCorpusLane[],
): boolean {
  const baselineKeys = baseline.map((lane) => laneKey(lane));
  const candidateKeys = candidate.map((lane) => laneKey(lane));
  return (
    baselineKeys.length > 0 &&
    baselineKeys.length === candidateKeys.length &&
    baselineKeys.every((key, index) => key === candidateKeys[index])
  );
}

function exactLaneJobCounts(
  baseline: FixedCorpusLane[],
  candidate: FixedCorpusLane[],
): boolean {
  const candidateCounts = new Map(
    candidate.map((lane) => [laneKey(lane), lane.jobCount]),
  );
  return baseline.every(
    (lane) => candidateCounts.get(laneKey(lane)) === lane.jobCount,
  );
}

function hasCompleteTelemetry(report: WindowIoReport): boolean {
  return (
    report.summary.expectedJobCount > 0 &&
    report.summary.completeJobCount === report.summary.expectedJobCount &&
    report.summary.measuredJobCount === report.summary.expectedJobCount &&
    report.integrityIssues.length === 0
  );
}

function excludedUnfinishedBuild(report: WindowIoReport): boolean {
  return report.unfinishedBuilds.some(
    (build) => build.disposition === "excluded",
  );
}

export function fixedCorpusGate(
  baseline: WindowIoReport,
  candidate: WindowIoReport,
): FixedCorpusGate {
  const baselineLanes = lanes(baseline);
  const candidateLanes = lanes(candidate);
  const writeChange = percentChange(
    candidate.summary.totalWriteBytes,
    baseline.summary.totalWriteBytes,
  );
  const durationChange =
    baseline.summary.p95DurationSeconds === null ||
    candidate.summary.p95DurationSeconds === null
      ? null
      : percentChange(
          candidate.summary.p95DurationSeconds,
          baseline.summary.p95DurationSeconds,
        );
  const writeReduction = writeChange === null ? null : -writeChange;
  const inconclusiveReasons: string[] = [];
  const thresholdReasons: string[] = [];

  const sameLanes = exactLanePresence(baselineLanes, candidateLanes);
  if (!sameLanes) {
    inconclusiveReasons.push(
      "fixed-corpus lanes differ between comparison windows",
    );
  } else if (!exactLaneJobCounts(baselineLanes, candidateLanes)) {
    inconclusiveReasons.push(
      "fixed-corpus lane job counts differ between comparison windows",
    );
  }
  if (!hasCompleteTelemetry(baseline) || !hasCompleteTelemetry(candidate)) {
    inconclusiveReasons.push(
      "one or both fixed-corpus windows have incomplete telemetry",
    );
  }
  if (excludedUnfinishedBuild(baseline) || excludedUnfinishedBuild(candidate)) {
    inconclusiveReasons.push(
      "one or both fixed-corpus cohorts excluded unfinished builds",
    );
  }
  if (writeReduction === null) {
    inconclusiveReasons.push(
      "aggregate write reduction could not be calculated",
    );
  } else if (writeReduction < 50) {
    thresholdReasons.push("aggregate write reduction is below 50%");
  }
  if (durationChange === null) {
    inconclusiveReasons.push("p95 duration change could not be calculated");
  } else if (durationChange > 10) {
    thresholdReasons.push("p95 duration regression exceeds 10%");
  }

  return {
    status:
      inconclusiveReasons.length > 0
        ? "inconclusive"
        : thresholdReasons.length > 0
          ? "failed"
          : "passed",
    aggregateWriteReductionPercent: writeReduction,
    p95DurationChangePercent: durationChange,
    baselineLanes,
    candidateLanes,
    reasons: [...inconclusiveReasons, ...thresholdReasons],
  };
}
