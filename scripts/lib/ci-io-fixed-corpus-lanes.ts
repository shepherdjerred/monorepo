import {
  fixedCorpusLaneDefinition,
  type FixedCorpusLane,
  type JobOutcomeReport,
  type WindowIoReport,
} from "./ci-io-report-model.ts";

export type CorpusLane = FixedCorpusLane & {
  p95DurationSeconds: number | null;
  totalWriteBytes: number;
};

export type CorpusJob = {
  branch: string;
  stepKey: string;
  buildNumber: number;
  jobId: string;
  jobState: string;
};

export function lanes(report: WindowIoReport): CorpusLane[] {
  const grouped = new Map<string, CorpusLane>();
  for (const lane of report.branchSteps) {
    const logicalStepKey = fixedCorpusLaneDefinition(lane.stepKey)?.[0];
    if (logicalStepKey === undefined) continue;
    const key = JSON.stringify([lane.branch, logicalStepKey]);
    const current = grouped.get(key);
    grouped.set(key, {
      branch: lane.branch,
      stepKey: logicalStepKey,
      jobCount: Math.max(current?.jobCount ?? 0, lane.jobCount),
      p95DurationSeconds:
        current?.p95DurationSeconds === null || lane.p95DurationSeconds === null
          ? null
          : (current?.p95DurationSeconds ?? 0) + lane.p95DurationSeconds,
      totalWriteBytes: (current?.totalWriteBytes ?? 0) + lane.totalWriteBytes,
    });
  }
  return [...grouped.values()].sort(
    (left, right) =>
      left.branch.localeCompare(right.branch) ||
      left.stepKey.localeCompare(right.stepKey),
  );
}

export function startedPhysicalSteps(
  report: WindowIoReport,
): ReadonlySet<string> {
  return new Set(
    report.jobOutcomes
      .filter((job) => job.started)
      .map((job) => JSON.stringify([job.buildNumber, job.stepKey])),
  );
}

export function isInactiveConditionalAlias(
  job: JobOutcomeReport,
  startedSteps: ReadonlySet<string>,
): boolean {
  const counterpart = fixedCorpusLaneDefinition(job.stepKey)?.[1];
  return (
    !job.started &&
    job.jobState === "broken" &&
    counterpart !== undefined &&
    startedSteps.has(JSON.stringify([job.buildNumber, counterpart]))
  );
}

export function corpusJobs(report: WindowIoReport): CorpusJob[] {
  const startedSteps = startedPhysicalSteps(report);
  const grouped = new Map<string, Map<string, CorpusJob[]>>();
  for (const job of report.jobOutcomes) {
    const logicalStepKey = fixedCorpusLaneDefinition(job.stepKey)?.[0];
    const inactiveConditionalAlias = isInactiveConditionalAlias(
      job,
      startedSteps,
    );
    if (logicalStepKey === undefined || inactiveConditionalAlias) continue;
    const key = JSON.stringify([job.branch, logicalStepKey, job.buildNumber]);
    const physical = grouped.get(key) ?? new Map<string, CorpusJob[]>();
    const jobs = physical.get(job.stepKey) ?? [];
    jobs.push({
      branch: job.branch,
      stepKey: logicalStepKey,
      buildNumber: job.buildNumber,
      jobId: job.jobId,
      jobState: job.jobState,
    });
    physical.set(job.stepKey, jobs);
    grouped.set(key, physical);
  }
  return logicalJobs(grouped);
}

function logicalJobs(
  grouped: ReadonlyMap<string, ReadonlyMap<string, readonly CorpusJob[]>>,
): CorpusJob[] {
  const result: CorpusJob[] = [];
  for (const physical of grouped.values()) {
    const attempts = Math.max(
      ...[...physical.values()].map((jobs) => jobs.length),
    );
    for (let index = 0; index < attempts; index += 1) {
      const members = [...physical.values()].flatMap((jobs) => {
        const job = jobs[index];
        return job === undefined ? [] : [job];
      });
      const first = members[0];
      if (first === undefined) continue;
      const failed = members.find((job) => job.jobState !== "passed");
      result.push({
        branch: first.branch,
        stepKey: first.stepKey,
        buildNumber: first.buildNumber,
        jobId: members.map((job) => job.jobId).join("+"),
        jobState: failed?.jobState ?? "passed",
      });
    }
  }
  return result.sort(
    (left, right) =>
      left.branch.localeCompare(right.branch) ||
      left.stepKey.localeCompare(right.stepKey) ||
      left.buildNumber - right.buildNumber,
  );
}
