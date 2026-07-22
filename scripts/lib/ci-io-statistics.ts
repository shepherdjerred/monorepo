import type {
  BranchStepIoReport,
  JobIoReport,
  StepIoReport,
  WindowComparison,
  WindowIoReport,
} from "./ci-io-report-model.ts";
import { fixedCorpusGate } from "./ci-io-fixed-corpus.ts";

export function percentile(values: number[], quantile: number): number | null {
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

function nodeJobCounts(jobs: JobIoReport[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const job of jobs) {
    const placement =
      job.nodes.length === 0 ? "<missing>" : job.nodes.join(",");
    counts.set(placement, (counts.get(placement) ?? 0) + 1);
  }
  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
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
    nodeJobCounts: nodeJobCounts(jobs),
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

export function summarizeBranchSteps(
  jobs: JobIoReport[],
): BranchStepIoReport[] {
  const grouped = new Map<
    string,
    { branch: string; stepKey: string; jobs: JobIoReport[] }
  >();
  for (const job of jobs) {
    const key = JSON.stringify([job.branch, job.stepKey]);
    const current = grouped.get(key);
    if (current === undefined) {
      grouped.set(key, {
        branch: job.branch,
        stepKey: job.stepKey,
        jobs: [job],
      });
    } else {
      current.jobs.push(job);
    }
  }
  return [...grouped.values()]
    .map((group) => ({
      branch: group.branch,
      ...summarizeStep(group.stepKey, group.jobs),
    }))
    .sort(
      (left, right) =>
        left.branch.localeCompare(right.branch) ||
        left.stepKey.localeCompare(right.stepKey),
    );
}

function percentChange(candidate: number, baseline: number): number | null {
  if (baseline === 0) {
    return null;
  }
  return ((candidate - baseline) / baseline) * 100;
}

export function compareWindows(
  baseline: WindowIoReport,
  candidate: WindowIoReport,
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
    fixedCorpusGate: fixedCorpusGate(baseline, candidate),
  };
}
