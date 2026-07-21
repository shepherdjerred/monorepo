import type { BuildkiteBuild, BuildkiteJob } from "./ci-io-api.ts";
import type { PodMeasurement } from "./ci-io-aggregate.ts";
import type { IntegrityIssue } from "./ci-io-report-model.ts";

function issue(
  code: IntegrityIssue["code"],
  message: string,
  jobId: string | null,
  pod: string | null,
): IntegrityIssue {
  return { code, message, jobId, pod };
}

function finishedTimestampSeconds(job: BuildkiteJob): number | null {
  return job.finished_at === null
    ? null
    : new Date(job.finished_at).getTime() / 1000;
}

function measurementHasPostFinishParentSample(
  measurement: PodMeasurement,
  finishedAtSeconds: number | null,
): boolean {
  return (
    finishedAtSeconds !== null &&
    measurement.lastParentSampleTimestampSeconds !== null &&
    measurement.lastParentSampleTimestampSeconds >= finishedAtSeconds
  );
}

export function allDevicesHavePostFinishParentSample(
  measurements: PodMeasurement[],
  job: BuildkiteJob,
): boolean {
  const finishedAtSeconds = finishedTimestampSeconds(job);
  return (
    measurements.length > 0 &&
    measurements.every((measurement) =>
      measurementHasPostFinishParentSample(measurement, finishedAtSeconds),
    )
  );
}

function metadataIssues(input: {
  build: BuildkiteBuild;
  job: BuildkiteJob;
  measurement: PodMeasurement;
  expectedStepKey: string;
  pipeline: string;
}): IntegrityIssue[] {
  const issues: IntegrityIssue[] = input.measurement.metadataConflicts.map(
    (message) =>
      issue("metadata-mismatch", message, input.job.id, input.measurement.pod),
  );
  const metadata = input.measurement.metadata;
  if (metadata === null) {
    return issues;
  }
  const matches =
    metadata.jobUuid === input.job.id &&
    metadata.stepKey === input.expectedStepKey &&
    metadata.branch === input.build.branch &&
    metadata.buildUrl === input.build.web_url &&
    metadata.jobUrl === input.job.web_url &&
    metadata.pipeline === input.pipeline;
  if (!matches) {
    issues.push(
      issue(
        "metadata-mismatch",
        "recording-rule metadata does not match the Buildkite job",
        input.job.id,
        input.measurement.pod,
      ),
    );
  }
  return issues;
}

type MeasurementIssuesInput = {
  build: BuildkiteBuild;
  job: BuildkiteJob;
  measurements: PodMeasurement[];
  durationSeconds: number;
  sampleCount: number;
  networkReceiveBytes: number | null;
  networkTransmitBytes: number | null;
  stepKey: string;
  pipeline: string;
  finished: boolean;
};

function jobIssues(input: MeasurementIssuesInput): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const { job, measurements } = input;
  if (!input.finished) {
    issues.push(issue("unfinished-job", "job is unfinished", job.id, null));
  }
  if (measurements.length > 1) {
    issues.push(
      issue(
        "ambiguous-job-pods",
        "multiple pods map to one Buildkite job",
        job.id,
        null,
      ),
    );
  }
  if (input.durationSeconds > 30 && measurements.length === 0) {
    issues.push(
      issue(
        "missing-long-job-measurement",
        "job longer than 30 seconds has no pod-parent measurement",
        job.id,
        null,
      ),
    );
  } else if (input.durationSeconds > 30 && input.sampleCount < 2) {
    issues.push(
      issue(
        "insufficient-long-job-samples",
        "job longer than 30 seconds has fewer than two samples",
        job.id,
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
        job.id,
        measurements[0]?.pod ?? null,
      ),
    );
  }
  return issues;
}

function podIssues(
  input: MeasurementIssuesInput,
  measurement: PodMeasurement,
  finishedAtSeconds: number | null,
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  if (measurement.nodes.length !== 1) {
    issues.push(
      issue(
        "multiple-pod-nodes",
        "pod-parent series report more than one node",
        input.job.id,
        measurement.pod,
      ),
    );
  }
  if (measurement.resetCount > 0) {
    issues.push(
      issue(
        "counter-reset",
        "pod-parent write counter reset during the report window",
        input.job.id,
        measurement.pod,
      ),
    );
  }
  if (
    input.finished &&
    !measurementHasPostFinishParentSample(measurement, finishedAtSeconds)
  ) {
    issues.push(
      issue(
        "missing-post-finish-parent-sample",
        `pod-parent devices do not all have a sample at or after Buildkite finished_at ${input.job.finished_at ?? "missing"}`,
        input.job.id,
        measurement.pod,
      ),
    );
  }
  if (measurement.networkResetCount > 0) {
    issues.push(
      issue(
        "network-counter-reset",
        "pod network counter reset during the report window",
        input.job.id,
        measurement.pod,
      ),
    );
  }
  issues.push(
    ...metadataIssues({
      build: input.build,
      job: input.job,
      measurement,
      expectedStepKey: input.stepKey,
      pipeline: input.pipeline,
    }),
  );
  return issues;
}

export function measurementIssues(
  input: MeasurementIssuesInput,
): IntegrityIssue[] {
  const issues = jobIssues(input);
  const finishedAtSeconds = finishedTimestampSeconds(input.job);
  for (const measurement of input.measurements) {
    issues.push(...podIssues(input, measurement, finishedAtSeconds));
  }
  return issues;
}
