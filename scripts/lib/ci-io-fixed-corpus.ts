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

const CONDITIONAL_STEP_COUNTERPART: ReadonlyMap<string, string> = new Map([
  ["playwright-e2e-pr", "playwright-e2e-main"],
  ["playwright-e2e-main", "playwright-e2e-pr"],
  ["resume-build-pr", "resume-build-main"],
  ["resume-build-main", "resume-build-pr"],
  ["docker-e2e-pr", "docker-e2e-main"],
  ["docker-e2e-main", "docker-e2e-pr"],
  ["images-pr", "images"],
  ["images", "images-pr"],
  ["tofu-plan", "tofu-apply"],
  ["tofu-apply", "tofu-plan"],
]);

type CorpusLane = FixedCorpusLane & {
  p95DurationSeconds: number | null;
  totalWriteBytes: number;
};

type CorpusJob = {
  branch: string;
  stepKey: string;
  buildNumber: number;
  jobId: string;
  jobState: string;
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

function corpusJobs(report: WindowIoReport): CorpusJob[] {
  const startedJobs = new Set(
    report.jobOutcomes
      .filter((job) => job.started)
      .map((job) => JSON.stringify([job.buildNumber, job.stepKey])),
  );
  return report.jobOutcomes
    .flatMap((job) => {
      const logicalStepKey = LOGICAL_LANE_BY_PIPELINE_STEP.get(job.stepKey);
      // Buildkite represents a false step-level `if` as an unstarted broken
      // job. Both PR and main variants are uploaded together, so ignore only
      // an alias whose mutually exclusive counterpart actually started in the
      // same build. A broken active alias and every other unsuccessful terminal
      // state remain visible and make the corpus inconclusive below.
      const counterpart = CONDITIONAL_STEP_COUNTERPART.get(job.stepKey);
      const inactiveConditionalAlias =
        !job.started &&
        job.jobState === "broken" &&
        counterpart !== undefined &&
        startedJobs.has(JSON.stringify([job.buildNumber, counterpart]));
      return logicalStepKey === undefined || inactiveConditionalAlias
        ? []
        : [
            {
              branch: job.branch,
              stepKey: logicalStepKey,
              buildNumber: job.buildNumber,
              jobId: job.jobId,
              jobState: job.jobState,
            },
          ];
    })
    .sort(
      (left, right) =>
        left.branch.localeCompare(right.branch) ||
        left.stepKey.localeCompare(right.stepKey) ||
        left.buildNumber - right.buildNumber,
    );
}

function laneKey(lane: Pick<FixedCorpusLane, "branch" | "stepKey">): string {
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

function hasDuplicateLanes(corpusLanes: FixedCorpusLane[]): boolean {
  return duplicateLaneDescriptions(corpusLanes).length > 0;
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

function laneDescription(
  lane: Pick<FixedCorpusLane, "branch" | "stepKey">,
): string {
  return `${lane.branch} / ${lane.stepKey}`;
}

function corpusJobCountMismatches(
  corpusLanes: FixedCorpusLane[],
  jobs: CorpusJob[],
): string[] {
  const expected = new Map<string, number>();
  const actual = new Map<string, number>();
  const descriptions = new Map<string, string>();
  for (const lane of corpusLanes) {
    const key = laneKey(lane);
    expected.set(key, (expected.get(key) ?? 0) + lane.jobCount);
    descriptions.set(key, laneDescription(lane));
  }
  for (const job of jobs) {
    const key = laneKey(job);
    actual.set(key, (actual.get(key) ?? 0) + 1);
    descriptions.set(key, laneDescription(job));
  }
  return [...new Set([...expected.keys(), ...actual.keys()])]
    .filter((key) => expected.get(key) !== actual.get(key))
    .map(
      (key) =>
        `${descriptions.get(key) ?? key} expected ${String(expected.get(key) ?? 0)}, found ${String(actual.get(key) ?? 0)}`,
    )
    .sort();
}

function unsuccessfulCorpusJobs(jobs: CorpusJob[]): string[] {
  return jobs
    .filter((job) => job.jobState !== "passed")
    .map(
      (job) =>
        `#${job.buildNumber.toString()} ${laneDescription(job)} ${job.jobId} (${job.jobState})`,
    )
    .sort();
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

function corpusIntegrityReasons(input: {
  baseline: WindowIoReport;
  candidate: WindowIoReport;
  baselineLanes: CorpusLane[];
  candidateLanes: CorpusLane[];
  baselineJobs: CorpusJob[];
  candidateJobs: CorpusJob[];
}): string[] {
  const reasons: string[] = [];
  const duplicateBaselineLanes = duplicateLaneDescriptions(input.baselineLanes);
  if (duplicateBaselineLanes.length > 0) {
    reasons.push(
      `baseline fixed-corpus window mixes pipeline schemas for logical lanes: ${duplicateBaselineLanes.join(", ")}`,
    );
  }
  const duplicateCandidateLanes = duplicateLaneDescriptions(
    input.candidateLanes,
  );
  if (duplicateCandidateLanes.length > 0) {
    reasons.push(
      `candidate fixed-corpus window mixes pipeline schemas for logical lanes: ${duplicateCandidateLanes.join(", ")}`,
    );
  }

  if (!exactLanePresence(input.baselineLanes, input.candidateLanes)) {
    reasons.push("fixed-corpus lanes differ between comparison windows");
  } else if (!exactLaneJobCounts(input.baselineLanes, input.candidateLanes)) {
    reasons.push(
      "fixed-corpus lane job counts differ between comparison windows",
    );
  }
  const missingBaselineLaneGroups = missingRequiredLaneGroups(
    input.baselineLanes,
  );
  if (missingBaselineLaneGroups.length > 0) {
    reasons.push(
      `baseline fixed-corpus window is missing required validation lanes: ${missingBaselineLaneGroups.join(", ")}`,
    );
  }
  const missingCandidateLaneGroups = missingRequiredLaneGroups(
    input.candidateLanes,
  );
  if (missingCandidateLaneGroups.length > 0) {
    reasons.push(
      `candidate fixed-corpus window is missing required validation lanes: ${missingCandidateLaneGroups.join(", ")}`,
    );
  }
  const baselineJobCountMismatches = corpusJobCountMismatches(
    input.baselineLanes,
    input.baselineJobs,
  );
  if (baselineJobCountMismatches.length > 0) {
    reasons.push(
      `baseline fixed-corpus job records do not match lane counts: ${baselineJobCountMismatches.join(", ")}`,
    );
  }
  const candidateJobCountMismatches = corpusJobCountMismatches(
    input.candidateLanes,
    input.candidateJobs,
  );
  if (candidateJobCountMismatches.length > 0) {
    reasons.push(
      `candidate fixed-corpus job records do not match lane counts: ${candidateJobCountMismatches.join(", ")}`,
    );
  }
  const unsuccessfulBaselineJobs = unsuccessfulCorpusJobs(input.baselineJobs);
  if (unsuccessfulBaselineJobs.length > 0) {
    reasons.push(
      `baseline fixed-corpus jobs did not all pass: ${unsuccessfulBaselineJobs.join(", ")}`,
    );
  }
  const unsuccessfulCandidateJobs = unsuccessfulCorpusJobs(input.candidateJobs);
  if (unsuccessfulCandidateJobs.length > 0) {
    reasons.push(
      `candidate fixed-corpus jobs did not all pass: ${unsuccessfulCandidateJobs.join(", ")}`,
    );
  }
  if (
    !hasCompleteTelemetry(input.baseline) ||
    !hasCompleteTelemetry(input.candidate)
  ) {
    reasons.push("one or both fixed-corpus windows have incomplete telemetry");
  }
  if (
    hasUnfinishedBuild(input.baseline) ||
    hasUnfinishedBuild(input.candidate)
  ) {
    reasons.push("one or both fixed-corpus cohorts excluded unfinished builds");
  }
  return reasons;
}

export function fixedCorpusGate(
  baseline: WindowIoReport,
  candidate: WindowIoReport,
): FixedCorpusGate {
  const baselineLanes = lanes(baseline);
  const candidateLanes = lanes(candidate);
  const baselineJobs = corpusJobs(baseline);
  const candidateJobs = corpusJobs(candidate);
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
  const inconclusiveReasons = corpusIntegrityReasons({
    baseline,
    candidate,
    baselineLanes,
    candidateLanes,
    baselineJobs,
    candidateJobs,
  });
  const thresholdReasons: string[] = [];
  if (writeReduction === null) {
    inconclusiveReasons.push(
      "aggregate write reduction could not be calculated",
    );
  } else if (writeReduction < 50) {
    thresholdReasons.push("aggregate write reduction is below 50%");
  }
  if (!hasDuplicateLanes(baselineLanes) && !hasDuplicateLanes(candidateLanes)) {
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
