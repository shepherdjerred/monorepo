import type {
  ComparisonGates,
  FixtureGate,
  JobIoReport,
  StepIoReport,
  WindowComparison,
  WindowIoReport,
} from "./ci-io-report-model.ts";

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const rank = (sorted.length - 1) * quantile;
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === undefined || upper === undefined) {
    throw new Error("percentile index fell outside the sorted values");
  }
  if (lowerIndex === upperIndex) {
    return lower;
  }
  return lower + (upper - lower) * (rank - lowerIndex);
}

function measuredWrites(jobs: JobIoReport[]): number[] {
  const values: number[] = [];
  for (const job of jobs) {
    if (job.writeBytes !== null) {
      values.push(job.writeBytes);
    }
  }
  return values;
}

function measuredNetwork(jobs: JobIoReport[]): number[] {
  const values: number[] = [];
  for (const job of jobs) {
    if (job.networkReceiveBytes !== null && job.networkTransmitBytes !== null) {
      values.push(job.networkReceiveBytes + job.networkTransmitBytes);
    }
  }
  return values;
}

function sumWrites(
  jobs: JobIoReport[],
  predicate: (job: JobIoReport) => boolean,
): number {
  return jobs.reduce((total, job) => {
    if (!predicate(job) || job.writeBytes === null) {
      return total;
    }
    return total + job.writeBytes;
  }, 0);
}

function summarizeStep(stepKey: string, jobs: JobIoReport[]): StepIoReport {
  const writes = measuredWrites(jobs);
  const network = measuredNetwork(jobs);
  return {
    stepKey,
    jobCount: jobs.length,
    measuredJobCount: writes.length,
    completeJobCount: jobs.filter((job) => job.coverage === "complete").length,
    lowerBoundJobCount: jobs.filter((job) => job.coverage === "lower-bound")
      .length,
    missingJobCount: jobs.filter((job) => job.coverage === "missing").length,
    totalWriteBytes: writes.reduce((total, value) => total + value, 0),
    medianWriteBytes: percentile(writes, 0.5),
    p95WriteBytes: percentile(writes, 0.95),
    medianDurationSeconds: percentile(
      jobs.map((job) => job.durationSeconds),
      0.5,
    ),
    p95DurationSeconds: percentile(
      jobs.map((job) => job.durationSeconds),
      0.95,
    ),
    medianNetworkBytes: percentile(network, 0.5),
    p95NetworkBytes: percentile(network, 0.95),
    canceledBuildWriteBytes: sumWrites(
      jobs,
      (job) => job.buildState === "canceled",
    ),
    canceledJobWriteBytes: sumWrites(
      jobs,
      (job) => job.jobState === "canceled",
    ),
  };
}

export function summarizeSteps(jobs: JobIoReport[]): StepIoReport[] {
  const grouped = new Map<string, JobIoReport[]>();
  for (const job of jobs) {
    const current = grouped.get(job.stepKey) ?? [];
    current.push(job);
    grouped.set(job.stepKey, current);
  }
  return [...grouped.entries()]
    .map(([stepKey, stepJobs]) => summarizeStep(stepKey, stepJobs))
    .sort((left, right) => left.stepKey.localeCompare(right.stepKey));
}

function percentChange(candidate: number, baseline: number): number | null {
  if (baseline === 0) {
    return null;
  }
  return ((candidate - baseline) / baseline) * 100;
}

function fixtureGate(
  stepKey: string,
  baseline: StepIoReport | undefined,
  candidate: StepIoReport | undefined,
): FixtureGate {
  if (baseline === undefined || candidate === undefined) {
    return {
      stepKey,
      status: "inconclusive",
      writeReductionPercent: null,
      durationChangePercent: null,
      networkChangePercent: null,
      reasons: ["step is absent from one comparison window"],
    };
  }
  const writeChange =
    baseline.medianWriteBytes === null || candidate.medianWriteBytes === null
      ? null
      : percentChange(candidate.medianWriteBytes, baseline.medianWriteBytes);
  const durationChange =
    baseline.medianDurationSeconds === null ||
    candidate.medianDurationSeconds === null
      ? null
      : percentChange(
          candidate.medianDurationSeconds,
          baseline.medianDurationSeconds,
        );
  const networkChange =
    baseline.medianNetworkBytes === null ||
    candidate.medianNetworkBytes === null
      ? null
      : percentChange(
          candidate.medianNetworkBytes,
          baseline.medianNetworkBytes,
        );
  const reasons: string[] = [];
  if (writeChange === null) {
    reasons.push("write metrics are missing or have a zero baseline");
  }
  if (durationChange === null) {
    reasons.push("duration metrics are missing or have a zero baseline");
  }
  if (networkChange === null) {
    reasons.push("network metrics are missing or have a zero baseline");
  }
  if (
    writeChange === null ||
    durationChange === null ||
    networkChange === null
  ) {
    return {
      stepKey,
      status: "inconclusive",
      writeReductionPercent: writeChange === null ? null : -writeChange,
      durationChangePercent: durationChange,
      networkChangePercent: networkChange,
      reasons,
    };
  }
  const writeReduction = -writeChange;
  if (writeReduction < 20) {
    reasons.push("write reduction is below 20%");
  }
  if (durationChange > 10) {
    reasons.push("duration regression exceeds 10%");
  }
  if (networkChange > 10) {
    reasons.push("network regression exceeds 10%");
  }
  return {
    stepKey,
    status: reasons.length === 0 ? "passed" : "failed",
    writeReductionPercent: writeReduction,
    durationChangePercent: durationChange,
    networkChangePercent: networkChange,
    reasons,
  };
}

function geometricMeanReduction(fixtures: FixtureGate[]): number | null {
  const ratios: number[] = [];
  for (const fixture of fixtures) {
    if (fixture.writeReductionPercent === null) {
      return null;
    }
    ratios.push(1 - fixture.writeReductionPercent / 100);
  }
  if (ratios.length === 0 || ratios.some((ratio) => ratio < 0)) {
    return null;
  }
  if (ratios.includes(0)) {
    return 100;
  }
  const meanLog =
    ratios.reduce((total, ratio) => total + Math.log(ratio), 0) / ratios.length;
  return (1 - Math.exp(meanLog)) * 100;
}

function comparisonGates(
  baseline: WindowIoReport,
  candidate: WindowIoReport,
  fixtureStepKeys: Set<string> | null,
): ComparisonGates {
  const baselineSteps = new Map(
    baseline.steps.map((step) => [step.stepKey, step]),
  );
  const candidateSteps = new Map(
    candidate.steps.map((step) => [step.stepKey, step]),
  );
  const availableKeys = new Set([
    ...baselineSteps.keys(),
    ...candidateSteps.keys(),
  ]);
  const keys =
    fixtureStepKeys === null
      ? [...availableKeys].sort()
      : [...fixtureStepKeys].sort();
  const fixtures = keys.map((key) =>
    fixtureGate(key, baselineSteps.get(key), candidateSteps.get(key)),
  );
  const geometricReduction = geometricMeanReduction(fixtures);
  const reasons: string[] = [];
  if (
    baseline.integrityIssues.length > 0 ||
    candidate.integrityIssues.length > 0
  ) {
    reasons.push("one or both windows have metric-integrity issues");
  }
  if (fixtures.length === 0) {
    reasons.push("no fixture steps were available for comparison");
  }
  if (fixtures.some((fixture) => fixture.status === "inconclusive")) {
    reasons.push("one or more fixture comparisons are inconclusive");
  }
  if (geometricReduction === null) {
    reasons.push("geometric-mean write reduction could not be calculated");
  } else if (geometricReduction < 30) {
    reasons.push("geometric-mean write reduction is below 30%");
  }
  const inconclusive = reasons.some(
    (reason) =>
      reason.includes("integrity") ||
      reason.includes("inconclusive") ||
      reason.includes("could not") ||
      reason.includes("no fixture"),
  );
  const failed =
    fixtures.some((fixture) => fixture.status === "failed") ||
    (geometricReduction !== null && geometricReduction < 30);
  return {
    status: inconclusive ? "inconclusive" : failed ? "failed" : "passed",
    geometricMeanWriteReductionPercent: geometricReduction,
    fixtures,
    reasons,
  };
}

export function compareWindows(
  baseline: WindowIoReport,
  candidate: WindowIoReport,
  fixtureStepKeys: Set<string> | null = null,
): WindowComparison {
  const baselinePerJob =
    baseline.summary.measuredJobCount === 0
      ? 0
      : baseline.summary.totalWriteBytes / baseline.summary.measuredJobCount;
  const candidatePerJob =
    candidate.summary.measuredJobCount === 0
      ? 0
      : candidate.summary.totalWriteBytes / candidate.summary.measuredJobCount;
  return {
    writeBytesChange:
      candidate.summary.totalWriteBytes - baseline.summary.totalWriteBytes,
    writeBytesChangePercent: percentChange(
      candidate.summary.totalWriteBytes,
      baseline.summary.totalWriteBytes,
    ),
    writeBytesPerJobChangePercent: percentChange(
      candidatePerJob,
      baselinePerJob,
    ),
    gates: comparisonGates(baseline, candidate, fixtureStepKeys),
  };
}
