import type { BuildkiteBuild, BuildkiteJob, TimeWindow } from "./ci-io-api.ts";
import { aggregatePodMetrics, type PodMeasurement } from "./ci-io-aggregate.ts";
import type { PrometheusIoMetrics } from "./ci-io-prometheus.ts";
import type {
  Coverage,
  IntegrityIssue,
  JobIoReport,
  WindowIoReport,
  WindowIoSummary,
} from "./ci-io-report-model.ts";
import { summarizeSteps } from "./ci-io-statistics.ts";

type JobContext = {
  build: BuildkiteBuild;
  job: BuildkiteJob;
};

export type BuildWindowReportInput = {
  builds: BuildkiteBuild[];
  window: TimeWindow;
  metrics: PrometheusIoMetrics;
  pipeline: string;
  excludedJobIds: Set<string>;
};

function issue(
  code: IntegrityIssue["code"],
  message: string,
  jobId: string | null,
  pod: string | null,
): IntegrityIssue {
  return { code, message, jobId, pod };
}

function jobContexts(builds: BuildkiteBuild[]): Map<string, JobContext> {
  const contexts = new Map<string, JobContext>();
  for (const build of builds) {
    for (const job of build.jobs) {
      if (contexts.has(job.id)) {
        throw new Error(`duplicate Buildkite job id ${job.id}`);
      }
      contexts.set(job.id, { build, job });
    }
  }
  return contexts;
}

function measurementsByJob(
  measurements: PodMeasurement[],
): Map<string, PodMeasurement[]> {
  const grouped = new Map<string, PodMeasurement[]>();
  for (const measurement of measurements) {
    const current = grouped.get(measurement.jobUuid) ?? [];
    current.push(measurement);
    grouped.set(measurement.jobUuid, current);
  }
  return grouped;
}

function jobDuration(
  job: BuildkiteJob,
  window: TimeWindow,
): {
  seconds: number;
  finished: boolean;
} {
  if (job.started_at === null) {
    throw new Error(`job ${job.id} has no start timestamp`);
  }
  const started = new Date(job.started_at).getTime();
  const finished =
    job.finished_at === null
      ? window.to.getTime()
      : new Date(job.finished_at).getTime();
  if (finished < started) {
    throw new Error(`job ${job.id} finished before it started`);
  }
  return {
    seconds: (finished - started) / 1000,
    finished: job.finished_at !== null,
  };
}

function sumComponentRecords(
  records: Record<string, number>[],
): Record<string, number> {
  const totals = new Map<string, number>();
  for (const record of records) {
    for (const [container, bytes] of Object.entries(record)) {
      totals.set(container, (totals.get(container) ?? 0) + bytes);
    }
  }
  return Object.fromEntries(
    [...totals.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function sumNetwork(
  measurements: PodMeasurement[],
  field: "networkReceiveBytes" | "networkTransmitBytes",
): number | null {
  let total = 0;
  for (const measurement of measurements) {
    const value = measurement[field];
    if (value === null) {
      return null;
    }
    total += value;
  }
  return measurements.length === 0 ? null : total;
}

function coverageFor(
  durationSeconds: number,
  measurements: PodMeasurement[],
  sampleCount: number,
): Coverage {
  if (measurements.length === 0) {
    return "missing";
  }
  if (durationSeconds <= 30 || sampleCount < 2) {
    return "lower-bound";
  }
  return "complete";
}

function metadataIssues(
  context: JobContext,
  measurement: PodMeasurement,
  expectedStepKey: string,
  pipeline: string,
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = measurement.metadataConflicts.map(
    (message) =>
      issue("metadata-mismatch", message, context.job.id, measurement.pod),
  );
  const metadata = measurement.metadata;
  if (metadata === null) {
    return issues;
  }
  const matches =
    metadata.jobUuid === context.job.id &&
    metadata.stepKey === expectedStepKey &&
    metadata.branch === context.build.branch &&
    metadata.buildUrl === context.build.web_url &&
    metadata.jobUrl === context.job.web_url &&
    metadata.pipeline === pipeline;
  if (!matches) {
    issues.push(
      issue(
        "metadata-mismatch",
        "recording-rule metadata does not match the Buildkite job",
        context.job.id,
        measurement.pod,
      ),
    );
  }
  return issues;
}

function measurementIssues(input: {
  context: JobContext;
  measurements: PodMeasurement[];
  durationSeconds: number;
  sampleCount: number;
  networkReceiveBytes: number | null;
  networkTransmitBytes: number | null;
  stepKey: string;
  pipeline: string;
  finished: boolean;
}): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const { context, measurements } = input;
  if (!input.finished) {
    issues.push(
      issue("unfinished-job", "job is unfinished", context.job.id, null),
    );
  }
  if (measurements.length > 1) {
    issues.push(
      issue(
        "ambiguous-job-pods",
        "multiple pods map to one Buildkite job",
        context.job.id,
        null,
      ),
    );
  }
  if (input.durationSeconds > 30 && measurements.length === 0) {
    issues.push(
      issue(
        "missing-long-job-measurement",
        "job longer than 30 seconds has no pod-parent measurement",
        context.job.id,
        null,
      ),
    );
  } else if (input.durationSeconds > 30 && input.sampleCount < 2) {
    issues.push(
      issue(
        "insufficient-long-job-samples",
        "job longer than 30 seconds has fewer than two samples",
        context.job.id,
        measurements[0]?.pod ?? null,
      ),
    );
  }
  if (
    input.durationSeconds > 30 &&
    measurements.length > 0 &&
    (input.networkReceiveBytes === null || input.networkTransmitBytes === null)
  ) {
    issues.push(
      issue(
        "missing-network-measurement",
        "job longer than 30 seconds is missing pod network metrics",
        context.job.id,
        measurements[0]?.pod ?? null,
      ),
    );
  }
  for (const measurement of measurements) {
    if (measurement.nodes.length !== 1) {
      issues.push(
        issue(
          "multiple-pod-nodes",
          "pod-parent series report more than one node",
          context.job.id,
          measurement.pod,
        ),
      );
    }
    if (measurement.resetCount > 0) {
      issues.push(
        issue(
          "counter-reset",
          "pod-parent write counter reset during the report window",
          context.job.id,
          measurement.pod,
        ),
      );
    }
    if (measurement.networkResetCount > 0) {
      issues.push(
        issue(
          "network-counter-reset",
          "pod network counter reset during the report window",
          context.job.id,
          measurement.pod,
        ),
      );
    }
    issues.push(
      ...metadataIssues(context, measurement, input.stepKey, input.pipeline),
    );
  }
  return issues;
}

function createJobReport(input: {
  context: JobContext;
  measurements: PodMeasurement[];
  window: TimeWindow;
  pipeline: string;
}): { report: JobIoReport; issues: IntegrityIssue[] } {
  const { context, measurements } = input;
  const duration = jobDuration(context.job, input.window);
  const sampleCount =
    measurements.length === 0
      ? 0
      : Math.min(...measurements.map((measurement) => measurement.sampleCount));
  const networkReceiveBytes = sumNetwork(measurements, "networkReceiveBytes");
  const networkTransmitBytes = sumNetwork(measurements, "networkTransmitBytes");
  const stepKey = context.job.step_key ?? `unkeyed:${context.job.name}`;
  const report: JobIoReport = {
    buildNumber: context.build.number,
    buildState: context.build.state,
    buildUrl: context.build.web_url,
    branch: context.build.branch,
    jobId: context.job.id,
    jobName: context.job.name,
    jobState: context.job.state,
    jobUrl: context.job.web_url,
    stepKey,
    pods: measurements.map((measurement) => measurement.pod).sort(),
    nodes: [
      ...new Set(measurements.flatMap((measurement) => measurement.nodes)),
    ].sort(),
    durationSeconds: duration.seconds,
    finished: duration.finished,
    coverage: coverageFor(duration.seconds, measurements, sampleCount),
    sampleCount,
    writeBytes:
      measurements.length === 0
        ? null
        : measurements.reduce(
            (total, measurement) => total + measurement.writeBytes,
            0,
          ),
    networkReceiveBytes,
    networkTransmitBytes,
    componentWriteBytes: sumComponentRecords(
      measurements.map((measurement) => measurement.componentWriteBytes),
    ),
  };
  return {
    report,
    issues: measurementIssues({
      context,
      measurements,
      durationSeconds: duration.seconds,
      sampleCount,
      networkReceiveBytes,
      networkTransmitBytes,
      stepKey,
      pipeline: input.pipeline,
      finished: duration.finished,
    }),
  };
}

function componentSummary(jobs: JobIoReport[]): {
  bytes: Record<string, number>;
  shares: Record<string, number>;
} {
  const bytes = sumComponentRecords(jobs.map((job) => job.componentWriteBytes));
  const total = Object.values(bytes).reduce((sum, value) => sum + value, 0);
  const shares = Object.fromEntries(
    Object.entries(bytes).map(([container, value]) => [
      container,
      total === 0 ? 0 : value / total,
    ]),
  );
  return { bytes, shares };
}

function summarizeWindow(
  builds: BuildkiteBuild[],
  jobs: JobIoReport[],
  unmatchedWriteBytes: number,
): WindowIoSummary {
  const measured = jobs.filter((job) => job.writeBytes !== null);
  const component = componentSummary(jobs);
  const totalWriteBytes = measured.reduce(
    (total, job) => total + (job.writeBytes ?? 0),
    0,
  );
  return {
    buildCount: builds.length,
    expectedJobCount: jobs.length,
    measuredJobCount: measured.length,
    completeJobCount: jobs.filter((job) => job.coverage === "complete").length,
    lowerBoundJobCount: jobs.filter((job) => job.coverage === "lower-bound")
      .length,
    missingJobCount: jobs.filter((job) => job.coverage === "missing").length,
    networkMeasuredJobCount: jobs.filter(
      (job) =>
        job.networkReceiveBytes !== null && job.networkTransmitBytes !== null,
    ).length,
    sampleCoveragePercent:
      jobs.length === 0 ? null : (measured.length / jobs.length) * 100,
    totalWriteBytes,
    lowerBoundWriteBytes: jobs.reduce(
      (total, job) =>
        total + (job.coverage === "lower-bound" ? (job.writeBytes ?? 0) : 0),
      0,
    ),
    unmatchedWriteBytes,
    canceledBuildWriteBytes: jobs.reduce(
      (total, job) =>
        total + (job.buildState === "canceled" ? (job.writeBytes ?? 0) : 0),
      0,
    ),
    canceledJobWriteBytes: jobs.reduce(
      (total, job) =>
        total + (job.jobState === "canceled" ? (job.writeBytes ?? 0) : 0),
      0,
    ),
    totalNetworkReceiveBytes: jobs.reduce(
      (total, job) => total + (job.networkReceiveBytes ?? 0),
      0,
    ),
    totalNetworkTransmitBytes: jobs.reduce(
      (total, job) => total + (job.networkTransmitBytes ?? 0),
      0,
    ),
    componentWriteBytes: component.bytes,
    componentWriteShares: component.shares,
  };
}

export function buildWindowIoReport(
  input: BuildWindowReportInput,
): WindowIoReport {
  const contexts = jobContexts(input.builds);
  const podMeasurements = aggregatePodMetrics(input.metrics);
  const groupedMeasurements = measurementsByJob(podMeasurements);
  const reports: JobIoReport[] = [];
  const issues: IntegrityIssue[] = [];

  for (const context of contexts.values()) {
    if (
      context.job.started_at === null ||
      input.excludedJobIds.has(context.job.id)
    ) {
      continue;
    }
    const created = createJobReport({
      context,
      measurements: groupedMeasurements.get(context.job.id) ?? [],
      window: input.window,
      pipeline: input.pipeline,
    });
    reports.push(created.report);
    issues.push(...created.issues);
  }

  let unmatchedWriteBytes = 0;
  for (const measurement of podMeasurements) {
    const context = contexts.get(measurement.jobUuid);
    if (context?.job.started_at === null || context === undefined) {
      unmatchedWriteBytes += measurement.writeBytes;
      issues.push(
        issue(
          "unmatched-pod",
          "pod does not map to a started job in the selected builds",
          null,
          measurement.pod,
        ),
      );
    }
  }

  reports.sort(
    (left, right) =>
      left.buildNumber - right.buildNumber ||
      left.stepKey.localeCompare(right.stepKey) ||
      left.jobId.localeCompare(right.jobId),
  );
  issues.sort(
    (left, right) =>
      left.code.localeCompare(right.code) ||
      (left.jobId ?? "").localeCompare(right.jobId ?? "") ||
      (left.pod ?? "").localeCompare(right.pod ?? ""),
  );

  return {
    from: input.window.from.toISOString(),
    to: input.window.to.toISOString(),
    buildNumbers: input.builds
      .map((build) => build.number)
      .sort((a, b) => a - b),
    jobs: reports,
    steps: summarizeSteps(reports),
    summary: summarizeWindow(input.builds, reports, unmatchedWriteBytes),
    integrityIssues: issues,
  };
}

export function assertBenchmarkIntegrity(report: WindowIoReport): void {
  if (report.integrityIssues.length === 0) {
    return;
  }
  const counts = new Map<string, number>();
  for (const currentIssue of report.integrityIssues) {
    counts.set(currentIssue.code, (counts.get(currentIssue.code) ?? 0) + 1);
  }
  const summary = [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, count]) => `${code}=${String(count)}`)
    .join(", ");
  throw new Error(`CI I/O benchmark integrity failed: ${summary}`);
}
