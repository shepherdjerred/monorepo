import { z } from "zod";

import type { MetricSource } from "./ci-io-prometheus.ts";

export const ComparisonProfileSchema = z.enum(["docker-ab", "fixed-corpus"]);
export type ComparisonProfile = z.infer<typeof ComparisonProfileSchema>;
export type GateStatus = "passed" | "failed" | "inconclusive";
export type Coverage = "complete" | "lower-bound" | "missing";

export type BuildCohort = {
  createdFrom: string;
  createdTo: string;
};

export type UnfinishedBuildReport = {
  buildNumber: number;
  branch: string;
  state: string;
  createdAt: string;
  buildUrl: string;
  disposition: "excluded" | "included-docker-ab";
};

export type IntegrityIssueCode =
  | "ambiguous-job-pods"
  | "counter-reset"
  | "insufficient-long-job-samples"
  | "metadata-mismatch"
  | "missing-long-job-measurement"
  | "missing-network-measurement"
  | "missing-post-finish-parent-sample"
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
  lastParentSampleAt: string | null;
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
  nodeJobCounts: Record<string, number>;
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

export type BranchStepIoReport = StepIoReport & {
  branch: string;
};

export type WindowIoSummary = {
  buildCount: number;
  expectedJobCount: number;
  measuredJobCount: number;
  completeJobCount: number;
  lowerBoundJobCount: number;
  missingJobCount: number;
  networkMeasuredJobCount: number;
  unfinishedBuildCount: number;
  excludedBuildCount: number;
  sampleCoveragePercent: number | null;
  p95DurationSeconds: number | null;
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
  cohort: BuildCohort | null;
  from: string;
  to: string;
  buildNumbers: number[];
  unfinishedBuilds: UnfinishedBuildReport[];
  jobs: JobIoReport[];
  steps: StepIoReport[];
  branchSteps: BranchStepIoReport[];
  summary: WindowIoSummary;
  integrityIssues: IntegrityIssue[];
};

export type FixtureGate = {
  stepKey: string;
  status: GateStatus;
  writeReductionPercent: number | null;
  durationChangePercent: number | null;
  networkChangePercent: number | null;
  reasons: string[];
};

export type ComparisonGates = {
  status: GateStatus;
  geometricMeanWriteReductionPercent: number | null;
  fixtures: FixtureGate[];
  reasons: string[];
};

export type FixedCorpusLane = {
  branch: string;
  stepKey: string;
  jobCount: number;
};

export type FixedCorpusGate = {
  status: GateStatus;
  aggregateWriteReductionPercent: number | null;
  p95DurationChangePercent: number | null;
  baselineLanes: FixedCorpusLane[];
  candidateLanes: FixedCorpusLane[];
  reasons: string[];
};

export type WindowComparison = {
  writeBytesChange: number;
  writeBytesChangePercent: number | null;
  writeBytesPerJobChangePercent: number | null;
  gates: ComparisonGates;
  fixedCorpusGate: FixedCorpusGate;
};

export type CiIoReport = {
  schemaVersion: 2;
  generatedAt: string;
  metricSource: MetricSource;
  comparisonProfile: ComparisonProfile;
  organization: string;
  pipeline: string;
  candidate: WindowIoReport;
  baseline: WindowIoReport | null;
  comparison: WindowComparison | null;
};
