import type {
  FixedCorpusGate,
  FixedCorpusLane,
  WindowIoReport,
} from "./ci-io-report-model.ts";

const REQUIRED_LANE_GROUPS = [
  { name: "docs-only", stepKey: "verify" },
  { name: "sjer.red", stepKey: "sjer.red" },
  { name: "Resume", stepKey: "resume" },
  { name: "LLM Docker E2E", stepKey: "docker-e2e" },
  { name: "image", stepKey: "images" },
  { name: "Tofu", stepKey: "tofu" },
] as const;

const LOGICAL_LANE_BY_PIPELINE_STEP: ReadonlyMap<string, string> = new Map([
  ["verify", "verify"],
  ["e2e", "sjer.red"],
  ["playwright-e2e-pr", "sjer.red"],
  ["playwright-e2e-main", "sjer.red"],
  ["resume-build", "resume"],
  ["resume-build-pr", "resume"],
  ["resume-build-main", "resume"],
  ["docker-e2e", "docker-e2e"],
  ["docker-e2e-pr", "docker-e2e"],
  ["docker-e2e-main", "docker-e2e"],
  ["images-pr", "images"],
  ["images", "images"],
  ["tofu-plan", "tofu"],
  ["tofu-apply", "tofu"],
]);

type CorpusLane = FixedCorpusLane & {
  p95DurationSeconds: number | null;
  totalWriteBytes: number;
};

function percentChange(candidate: number, baseline: number): number | null {
  if (baseline === 0) {
    return null;
  }
  return ((candidate - baseline) / baseline) * 100;
}

function reductionPercent(change: number | null): number | null {
  if (change === null || change === 0) {
    return change;
  }
  return -change;
}

function lanes(report: WindowIoReport): CorpusLane[] {
  return report.branchSteps
    .flatMap((lane) => {
      const logicalStepKey = LOGICAL_LANE_BY_PIPELINE_STEP.get(lane.stepKey);
      return logicalStepKey === undefined
        ? []
        : [
            {
              branch: lane.branch,
              stepKey: logicalStepKey,
              jobCount: lane.jobCount,
              p95DurationSeconds: lane.p95DurationSeconds,
              totalWriteBytes: lane.totalWriteBytes,
            },
          ];
    })
    .sort(
      (left, right) =>
        left.branch.localeCompare(right.branch) ||
        left.stepKey.localeCompare(right.stepKey),
    );
}

function laneKey(lane: FixedCorpusLane): string {
  return JSON.stringify([lane.branch, lane.stepKey]);
}

function duplicateLaneDescriptions(corpusLanes: FixedCorpusLane[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const lane of corpusLanes) {
    const key = laneKey(lane);
    if (seen.has(key)) {
      duplicates.add(`${lane.branch} / ${lane.stepKey}`);
    }
    seen.add(key);
  }
  return [...duplicates].sort();
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

function missingRequiredLaneGroups(corpusLanes: FixedCorpusLane[]): string[] {
  const stepKeys = new Set(corpusLanes.map((lane) => lane.stepKey));
  return REQUIRED_LANE_GROUPS.filter(
    (group) => !stepKeys.has(group.stepKey),
  ).map((group) => group.name);
}

function laneDescription(lane: FixedCorpusLane): string {
  return `${lane.branch} / ${lane.stepKey}`;
}

function enforceLaneDurationGates(
  baseline: CorpusLane[],
  candidate: CorpusLane[],
  inconclusiveReasons: string[],
  thresholdReasons: string[],
): void {
  const candidateLanes = new Map(
    candidate.map((lane) => [laneKey(lane), lane]),
  );
  for (const baselineLane of baseline) {
    const candidateLane = candidateLanes.get(laneKey(baselineLane));
    if (candidateLane === undefined) {
      continue;
    }
    const durationChange =
      baselineLane.p95DurationSeconds === null ||
      candidateLane.p95DurationSeconds === null
        ? null
        : percentChange(
            candidateLane.p95DurationSeconds,
            baselineLane.p95DurationSeconds,
          );
    if (durationChange === null) {
      inconclusiveReasons.push(
        `p95 duration change could not be calculated for lane ${laneDescription(baselineLane)}`,
      );
    } else if (durationChange > 10) {
      thresholdReasons.push(
        `p95 duration regression exceeds 10% for lane ${laneDescription(baselineLane)} (${durationChange.toFixed(1)}%)`,
      );
    }
  }
}

function hasCompleteTelemetry(report: WindowIoReport): boolean {
  return (
    report.summary.expectedJobCount > 0 &&
    report.summary.completeJobCount === report.summary.expectedJobCount &&
    report.summary.measuredJobCount === report.summary.expectedJobCount &&
    report.integrityIssues.length === 0
  );
}

function hasUnfinishedBuild(report: WindowIoReport): boolean {
  return report.unfinishedBuilds.length > 0;
}

export function fixedCorpusGate(
  baseline: WindowIoReport,
  candidate: WindowIoReport,
): FixedCorpusGate {
  const baselineLanes = lanes(baseline);
  const candidateLanes = lanes(candidate);
  const baselineCorpusWriteBytes = baselineLanes.reduce(
    (total, lane) => total + lane.totalWriteBytes,
    0,
  );
  const candidateCorpusWriteBytes = candidateLanes.reduce(
    (total, lane) => total + lane.totalWriteBytes,
    0,
  );
  const writeChange = percentChange(
    candidateCorpusWriteBytes,
    baselineCorpusWriteBytes,
  );
  const durationChange =
    baseline.summary.p95DurationSeconds === null ||
    candidate.summary.p95DurationSeconds === null
      ? null
      : percentChange(
          candidate.summary.p95DurationSeconds,
          baseline.summary.p95DurationSeconds,
        );
  const writeReduction = reductionPercent(writeChange);
  const inconclusiveReasons: string[] = [];
  const thresholdReasons: string[] = [];

  const duplicateBaselineLanes = duplicateLaneDescriptions(baselineLanes);
  if (duplicateBaselineLanes.length > 0) {
    inconclusiveReasons.push(
      `baseline fixed-corpus window mixes pipeline schemas for logical lanes: ${duplicateBaselineLanes.join(", ")}`,
    );
  }
  const duplicateCandidateLanes = duplicateLaneDescriptions(candidateLanes);
  if (duplicateCandidateLanes.length > 0) {
    inconclusiveReasons.push(
      `candidate fixed-corpus window mixes pipeline schemas for logical lanes: ${duplicateCandidateLanes.join(", ")}`,
    );
  }

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
  const missingBaselineLaneGroups = missingRequiredLaneGroups(baselineLanes);
  if (missingBaselineLaneGroups.length > 0) {
    inconclusiveReasons.push(
      `baseline fixed-corpus window is missing required validation lanes: ${missingBaselineLaneGroups.join(", ")}`,
    );
  }
  const missingCandidateLaneGroups = missingRequiredLaneGroups(candidateLanes);
  if (missingCandidateLaneGroups.length > 0) {
    inconclusiveReasons.push(
      `candidate fixed-corpus window is missing required validation lanes: ${missingCandidateLaneGroups.join(", ")}`,
    );
  }
  if (!hasCompleteTelemetry(baseline) || !hasCompleteTelemetry(candidate)) {
    inconclusiveReasons.push(
      "one or both fixed-corpus windows have incomplete telemetry",
    );
  }
  if (hasUnfinishedBuild(baseline) || hasUnfinishedBuild(candidate)) {
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
  if (
    duplicateBaselineLanes.length === 0 &&
    duplicateCandidateLanes.length === 0
  ) {
    enforceLaneDurationGates(
      baselineLanes,
      candidateLanes,
      inconclusiveReasons,
      thresholdReasons,
    );
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
    baselineLanes: baselineLanes.map(({ branch, stepKey, jobCount }) => ({
      branch,
      stepKey,
      jobCount,
    })),
    candidateLanes: candidateLanes.map(({ branch, stepKey, jobCount }) => ({
      branch,
      stepKey,
      jobCount,
    })),
    reasons: [...inconclusiveReasons, ...thresholdReasons],
  };
}
