import type { MetricSource } from "./ci-io-prometheus.ts";

export type Coverage = "complete" | "lower-bound" | "missing";

export type IntegrityIssueCode =
  | "ambiguous-job-pods"
  | "counter-reset"
  | "insufficient-long-job-samples"
  | "metadata-mismatch"
  | "missing-long-job-measurement"
  | "missing-network-measurement"
  | "multiple-pod-nodes"
  | "network-counter-reset"
  | "unfinished-job"
  | "unmatched-pod";

export type IntegrityIssue = {
  code: IntegrityIssueCode;
  message: string;
  jobId: string | null;
  pod: string | null;
};

export type JobIoReport = {
  buildNumber: number;
  buildState: string;
  buildUrl: string;
  branch: string;
  jobId: string;
  jobName: string;
  jobState: string;
  jobUrl: string;
  stepKey: string;
  pods: string[];
  nodes: string[];
  durationSeconds: number;
  finished: boolean;
  coverage: Coverage;
  sampleCount: number;
  writeBytes: number | null;
  networkReceiveBytes: number | null;
  networkTransmitBytes: number | null;
  componentWriteBytes: Record<string, number>;
};

export type StepIoReport = {
  stepKey: string;
  jobCount: number;
  measuredJobCount: number;
  completeJobCount: number;
  lowerBoundJobCount: number;
  missingJobCount: number;
  totalWriteBytes: number;
  medianWriteBytes: number | null;
  p95WriteBytes: number | null;
  medianDurationSeconds: number | null;
  p95DurationSeconds: number | null;
  medianNetworkBytes: number | null;
  p95NetworkBytes: number | null;
  canceledBuildWriteBytes: number;
  canceledJobWriteBytes: number;
};

export type WindowIoSummary = {
  buildCount: number;
  expectedJobCount: number;
  measuredJobCount: number;
  completeJobCount: number;
  lowerBoundJobCount: number;
  missingJobCount: number;
  networkMeasuredJobCount: number;
  sampleCoveragePercent: number | null;
  totalWriteBytes: number;
  lowerBoundWriteBytes: number;
  unmatchedWriteBytes: number;
  canceledBuildWriteBytes: number;
  canceledJobWriteBytes: number;
  totalNetworkReceiveBytes: number;
  totalNetworkTransmitBytes: number;
  componentWriteBytes: Record<string, number>;
  componentWriteShares: Record<string, number>;
};

export type WindowIoReport = {
  from: string;
  to: string;
  buildNumbers: number[];
  jobs: JobIoReport[];
  steps: StepIoReport[];
  summary: WindowIoSummary;
  integrityIssues: IntegrityIssue[];
};

export type FixtureGate = {
  stepKey: string;
  status: "passed" | "failed" | "inconclusive";
  writeReductionPercent: number | null;
  durationChangePercent: number | null;
  networkChangePercent: number | null;
  reasons: string[];
};

export type ComparisonGates = {
  status: "passed" | "failed" | "inconclusive";
  geometricMeanWriteReductionPercent: number | null;
  fixtures: FixtureGate[];
  reasons: string[];
};

export type WindowComparison = {
  writeBytesChange: number;
  writeBytesChangePercent: number | null;
  writeBytesPerJobChangePercent: number | null;
  gates: ComparisonGates;
};

export type CiIoReport = {
  schemaVersion: 1;
  generatedAt: string;
  metricSource: MetricSource;
  organization: string;
  pipeline: string;
  candidate: WindowIoReport;
  baseline: WindowIoReport | null;
  comparison: WindowComparison | null;
};
