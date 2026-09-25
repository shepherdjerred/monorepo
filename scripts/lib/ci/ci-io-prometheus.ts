import { z } from "zod";

import {
  queryPrometheusVector,
  type PrometheusClientConfig,
  type PrometheusVector,
  type TimeWindow,
} from "./ci-io-api.ts";

/**
 * Pod-level I/O series for CI steps, read through the recording rules.
 *
 * There used to be a second "raw" mode that queried cAdvisor directly and
 * recovered a job identity from the pod name, because Buildkite's agent stack
 * named each pod `buildkite-<job uuid>-<suffix>`. Woodpecker names step pods
 * `wp-<ULID>-<workflow>-step-<n>`, which identifies nothing, so a raw query
 * can no longer say which step it measured. Rather than keep a mode that would
 * attribute every byte to "unmatched", attribution now comes only from the
 * pod metadata the recording rules join in.
 *
 * The one piece of raw cAdvisor that survives is `parentLastSample`: a
 * recording rule's evaluation timestamp proves the rule ran, not that cAdvisor
 * scraped the final device counter, and coverage classification depends on
 * that distinction.
 */

const RawParentLabelsSchema = z.object({
  pod: z.string().min(1),
  node: z.string().min(1),
  // cAdvisor legitimately omits this label for pseudo-filesystems. Absence is
  // part of the Prometheus series identity; preserve it instead of dropping
  // those writes or inventing a device name.
  device: z.string().min(1).optional(),
});

const RawNetworkLabelsSchema = z.object({
  pod: z.string().min(1),
  node: z.string().min(1),
  interface: z.string().min(1),
});

/**
 * Metadata the configuration extension stamps on each step pod, flattened by
 * kube-state-metrics and joined in by the recording rules.
 *
 * The un-flattened keys live in
 * packages/woodpecker-config-extension/src/pipeline/emit.ts; the allowlist that
 * decides whether they are exported at all lives in the homelab observability
 * values. These names must match both.
 */
const RecordingMetadataLabelsSchema = z.object({
  pod: z.string().min(1),
  node: z.string().min(1),
  device: z.string().min(1).optional(),
  label_ci_sjer_red_commit: z.string().min(1),
  label_ci_sjer_red_step_key: z.string().min(1),
  annotation_ci_sjer_red_branch: z.string().min(1),
  annotation_ci_sjer_red_pipeline_url: z.url(),
});

const RecordingChildLabelsSchema = RecordingMetadataLabelsSchema.extend({
  container: z.string().min(1),
});

const MetricValueSchema = z.coerce.number().nonnegative();

export type MetricMetadata = {
  /** `<commit>:<step key>` — the same identity CiJob.id carries. */
  jobId: string;
  commit: string;
  stepKey: string;
  branch: string;
  pipelineUrl: string;
};

export type DeviceMetric = {
  pod: string;
  node: string;
  device: string | null;
  value: number;
  metadata: MetricMetadata | null;
};

export type ChildDeviceMetric = DeviceMetric & {
  container: string;
};

export type NetworkMetric = {
  pod: string;
  node: string;
  networkInterface: string;
  value: number;
};

export type IoQueries = {
  parentMax: string;
  parentSamples: string;
  parentLastSample: string;
  parentResets: string;
  childMax: string;
  networkReceiveMax: string;
  networkTransmitMax: string;
  networkReceiveResets: string;
  networkTransmitResets: string;
};

export type PrometheusIoMetrics = {
  parentMax: DeviceMetric[];
  parentSamples: DeviceMetric[];
  parentLastSample: DeviceMetric[];
  parentResets: DeviceMetric[];
  childMax: ChildDeviceMetric[];
  networkReceiveMax: NetworkMetric[];
  networkTransmitMax: NetworkMetric[];
  networkReceiveResets: NetworkMetric[];
  networkTransmitResets: NetworkMetric[];
};

/**
 * Pods whose metadata attributes them to one of the selected jobs.
 *
 * A pod with no metadata is deliberately NOT filtered out here. It reaches the
 * report as an unmatched pod, which is an integrity issue — the case this
 * filter must never quietly swallow is telemetry that exists but cannot be
 * attributed.
 */
function podsForJobs(
  metrics: DeviceMetric[],
  jobIds: Set<string>,
): Set<string> {
  const pods = new Set<string>();
  for (const metric of metrics) {
    if (metric.metadata === null || jobIds.has(metric.metadata.jobId)) {
      pods.add(metric.pod);
    }
  }
  return pods;
}

export function filterPrometheusIoMetrics(
  metrics: PrometheusIoMetrics,
  jobIds: Set<string>,
): PrometheusIoMetrics {
  const pods = podsForJobs(metrics.parentMax, jobIds);
  return {
    parentMax: metrics.parentMax.filter((metric) => pods.has(metric.pod)),
    parentSamples: metrics.parentSamples.filter((metric) =>
      pods.has(metric.pod),
    ),
    parentLastSample: metrics.parentLastSample.filter((metric) =>
      pods.has(metric.pod),
    ),
    parentResets: metrics.parentResets.filter((metric) => pods.has(metric.pod)),
    childMax: metrics.childMax.filter((metric) => pods.has(metric.pod)),
    networkReceiveMax: metrics.networkReceiveMax.filter((metric) =>
      pods.has(metric.pod),
    ),
    networkTransmitMax: metrics.networkTransmitMax.filter((metric) =>
      pods.has(metric.pod),
    ),
    networkReceiveResets: metrics.networkReceiveResets.filter((metric) =>
      pods.has(metric.pod),
    ),
    networkTransmitResets: metrics.networkTransmitResets.filter((metric) =>
      pods.has(metric.pod),
    ),
  };
}

/**
 * Woodpecker's Kubernetes backend pod names. Must match CI_JOB_POD_PATTERN in
 * packages/homelab/.../monitoring/rules/woodpecker.ts, which scopes the
 * recording rules themselves.
 */
const POD_PATTERN = "wp-[0-9a-hjkmnp-tv-z]{26}";
export const CI_RECORDED_PARENT_WRITES_BY_JOB_METRIC =
  "woodpecker:pod_parent_fs_writes_bytes_by_job_total";
const RAW_PARENT_SELECTOR = `namespace="woodpecker-ci",container="",id=~"/kubepods.*pod[^/]+$",pod=~"${POD_PATTERN}"`;
const RAW_NETWORK_SELECTOR = `namespace="woodpecker-ci",container="",pod=~"${POD_PATTERN}"`;
const RECORDING_SELECTOR = `namespace="woodpecker-ci",pod=~"${POD_PATTERN}"`;

function parentLastSampleQuery(range: string): string {
  // Pin the subquery to the cAdvisor scrape interval so Prometheus's longer
  // default evaluation interval cannot step over the final scrape.
  return `max by (pod,node,device) (max_over_time(timestamp(container_fs_writes_bytes_total{${RAW_PARENT_SELECTOR}})[${range}:10s]))`;
}

function durationSeconds(window: TimeWindow): number {
  const duration = Math.ceil(
    (window.to.getTime() - window.from.getTime()) / 1000,
  );
  if (duration <= 0) {
    throw new Error("Prometheus query window must have positive duration");
  }
  return duration;
}

export function buildIoQueries(window: TimeWindow): IoQueries {
  const range = `${String(durationSeconds(window))}s`;
  return {
    parentMax: `max_over_time(${CI_RECORDED_PARENT_WRITES_BY_JOB_METRIC}{${RECORDING_SELECTOR}}[${range}])`,
    parentSamples: `count_over_time(woodpecker:pod_parent_sample_present{${RECORDING_SELECTOR}}[${range}])`,
    // Query the underlying cAdvisor series for the final timestamp. A
    // recording-rule evaluation timestamp only proves that the rule ran; it
    // does not prove that cAdvisor scraped the final device counter.
    parentLastSample: parentLastSampleQuery(range),
    parentResets: `resets(${CI_RECORDED_PARENT_WRITES_BY_JOB_METRIC}{${RECORDING_SELECTOR}}[${range}])`,
    childMax: `max_over_time(woodpecker:container_fs_writes_bytes_total{${RECORDING_SELECTOR},container!=""}[${range}])`,
    networkReceiveMax: `max by (pod,node,interface) (max_over_time(container_network_receive_bytes_total{${RAW_NETWORK_SELECTOR}}[${range}]))`,
    networkTransmitMax: `max by (pod,node,interface) (max_over_time(container_network_transmit_bytes_total{${RAW_NETWORK_SELECTOR}}[${range}]))`,
    networkReceiveResets: `max by (pod,node,interface) (resets(container_network_receive_bytes_total{${RAW_NETWORK_SELECTOR}}[${range}]))`,
    networkTransmitResets: `max by (pod,node,interface) (resets(container_network_transmit_bytes_total{${RAW_NETWORK_SELECTOR}}[${range}]))`,
  };
}

function metricValue(item: PrometheusVector[number]): number {
  return MetricValueSchema.parse(item.value[1]);
}

function metadataFromLabels(
  labels: z.infer<typeof RecordingMetadataLabelsSchema>,
): MetricMetadata {
  return {
    jobId: `${labels.label_ci_sjer_red_commit}:${labels.label_ci_sjer_red_step_key}`,
    commit: labels.label_ci_sjer_red_commit,
    stepKey: labels.label_ci_sjer_red_step_key,
    branch: labels.annotation_ci_sjer_red_branch,
    pipelineUrl: labels.annotation_ci_sjer_red_pipeline_url,
  };
}

function parseParentMetrics(vector: PrometheusVector): DeviceMetric[] {
  return vector.map((item) => {
    const labels = RecordingMetadataLabelsSchema.parse(item.metric);
    return {
      pod: labels.pod,
      node: labels.node,
      device: labels.device ?? null,
      value: metricValue(item),
      metadata: metadataFromLabels(labels),
    };
  });
}

/** The cAdvisor-sourced timestamp probe, which carries no joined metadata. */
function parseUnattributedParentMetrics(
  vector: PrometheusVector,
): DeviceMetric[] {
  return vector.map((item) => {
    const labels = RawParentLabelsSchema.parse(item.metric);
    return {
      pod: labels.pod,
      node: labels.node,
      device: labels.device ?? null,
      value: metricValue(item),
      metadata: null,
    };
  });
}

function parseChildMetrics(vector: PrometheusVector): ChildDeviceMetric[] {
  return vector.map((item) => {
    const labels = RecordingChildLabelsSchema.parse(item.metric);
    return {
      pod: labels.pod,
      node: labels.node,
      device: labels.device ?? null,
      container: labels.container,
      value: metricValue(item),
      metadata: metadataFromLabels(labels),
    };
  });
}

function parseNetworkMetrics(vector: PrometheusVector): NetworkMetric[] {
  return vector.map((item) => {
    const labels = RawNetworkLabelsSchema.parse(item.metric);
    return {
      pod: labels.pod,
      node: labels.node,
      networkInterface: labels.interface,
      value: metricValue(item),
    };
  });
}

export async function fetchPrometheusIoMetrics(input: {
  client: PrometheusClientConfig;
  window: TimeWindow;
}): Promise<PrometheusIoMetrics> {
  const queries = buildIoQueries(input.window);
  const results = await Promise.all([
    queryPrometheusVector(input.client, queries.parentMax, input.window.to),
    queryPrometheusVector(input.client, queries.parentSamples, input.window.to),
    queryPrometheusVector(
      input.client,
      queries.parentLastSample,
      input.window.to,
    ),
    queryPrometheusVector(input.client, queries.parentResets, input.window.to),
    queryPrometheusVector(input.client, queries.childMax, input.window.to),
    queryPrometheusVector(
      input.client,
      queries.networkReceiveMax,
      input.window.to,
    ),
    queryPrometheusVector(
      input.client,
      queries.networkTransmitMax,
      input.window.to,
    ),
    queryPrometheusVector(
      input.client,
      queries.networkReceiveResets,
      input.window.to,
    ),
    queryPrometheusVector(
      input.client,
      queries.networkTransmitResets,
      input.window.to,
    ),
  ]);
  const [
    parentMax,
    parentSamples,
    parentLastSample,
    parentResets,
    childMax,
    networkReceiveMax,
    networkTransmitMax,
    networkReceiveResets,
    networkTransmitResets,
  ] = results;
  return {
    parentMax: parseParentMetrics(parentMax),
    parentSamples: parseParentMetrics(parentSamples),
    parentLastSample: parseUnattributedParentMetrics(parentLastSample),
    parentResets: parseParentMetrics(parentResets),
    childMax: parseChildMetrics(childMax),
    networkReceiveMax: parseNetworkMetrics(networkReceiveMax),
    networkTransmitMax: parseNetworkMetrics(networkTransmitMax),
    networkReceiveResets: parseNetworkMetrics(networkReceiveResets),
    networkTransmitResets: parseNetworkMetrics(networkTransmitResets),
  };
}
