import { z } from "zod";

import {
  queryPrometheusVector,
  type PrometheusClientConfig,
  type PrometheusVector,
  type TimeWindow,
} from "./ci-io-api.ts";

export const MetricSourceSchema = z.enum(["raw", "recording"]);
export type MetricSource = z.infer<typeof MetricSourceSchema>;

const RawParentLabelsSchema = z.object({
  pod: z.string().min(1),
  node: z.string().min(1),
  // cAdvisor legitimately omits this label for pseudo-filesystems. Absence is
  // part of the Prometheus series identity; preserve it instead of dropping
  // those writes or inventing a device name.
  device: z.string().min(1).optional(),
});

const RawChildLabelsSchema = RawParentLabelsSchema.extend({
  container: z.string().min(1),
});

const RawNetworkLabelsSchema = z.object({
  pod: z.string().min(1),
  node: z.string().min(1),
  interface: z.string().min(1),
});

const RecordingMetadataLabelsSchema = z.object({
  pod: z.string().min(1),
  node: z.string().min(1),
  device: z.string().min(1).optional(),
  label_buildkite_com_job_uuid: z.uuid(),
  label_ci_sjer_red_step_key: z.string().min(1),
  annotation_buildkite_com_build_branch: z.string().min(1),
  annotation_buildkite_com_build_url: z.url(),
  annotation_buildkite_com_job_url: z.url(),
  annotation_buildkite_com_pipeline_slug: z.string().min(1),
});

const RecordingChildLabelsSchema = RecordingMetadataLabelsSchema.extend({
  container: z.string().min(1),
});

const MetricValueSchema = z.coerce.number().nonnegative();

export type MetricMetadata = {
  jobUuid: string;
  stepKey: string;
  branch: string;
  buildUrl: string;
  jobUrl: string;
  pipeline: string;
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

function podBelongsToJob(pod: string, jobIds: Set<string>): boolean {
  for (const jobId of jobIds) {
    if (pod.startsWith(`buildkite-${jobId}-`)) {
      return true;
    }
  }
  return false;
}

export function filterPrometheusIoMetrics(
  metrics: PrometheusIoMetrics,
  jobIds: Set<string>,
): PrometheusIoMetrics {
  return {
    parentMax: metrics.parentMax.filter((metric) =>
      podBelongsToJob(metric.pod, jobIds),
    ),
    parentSamples: metrics.parentSamples.filter((metric) =>
      podBelongsToJob(metric.pod, jobIds),
    ),
    parentLastSample: metrics.parentLastSample.filter((metric) =>
      podBelongsToJob(metric.pod, jobIds),
    ),
    parentResets: metrics.parentResets.filter((metric) =>
      podBelongsToJob(metric.pod, jobIds),
    ),
    childMax: metrics.childMax.filter((metric) =>
      podBelongsToJob(metric.pod, jobIds),
    ),
    networkReceiveMax: metrics.networkReceiveMax.filter((metric) =>
      podBelongsToJob(metric.pod, jobIds),
    ),
    networkTransmitMax: metrics.networkTransmitMax.filter((metric) =>
      podBelongsToJob(metric.pod, jobIds),
    ),
    networkReceiveResets: metrics.networkReceiveResets.filter((metric) =>
      podBelongsToJob(metric.pod, jobIds),
    ),
    networkTransmitResets: metrics.networkTransmitResets.filter((metric) =>
      podBelongsToJob(metric.pod, jobIds),
    ),
  };
}

const POD_PATTERN = "buildkite-[0-9a-f-]{36}-[a-z0-9]+";
const RAW_PARENT_SELECTOR = `namespace="buildkite",container="",id=~"/kubepods.*pod[^/]+$",pod=~"${POD_PATTERN}"`;
const RAW_CHILD_SELECTOR = `namespace="buildkite",container!="",pod=~"${POD_PATTERN}"`;
const RAW_NETWORK_SELECTOR = `namespace="buildkite",container="",pod=~"${POD_PATTERN}"`;
const RECORDING_SELECTOR = `namespace="buildkite",pod=~"${POD_PATTERN}"`;

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

function rawQueries(range: string): IoQueries {
  return {
    parentMax: `max by (pod,node,device) (max_over_time(container_fs_writes_bytes_total{${RAW_PARENT_SELECTOR}}[${range}]))`,
    parentSamples: `max by (pod,node,device) (count_over_time(container_fs_writes_bytes_total{${RAW_PARENT_SELECTOR}}[${range}]))`,
    parentLastSample: parentLastSampleQuery(range),
    parentResets: `max by (pod,node,device) (resets(container_fs_writes_bytes_total{${RAW_PARENT_SELECTOR}}[${range}]))`,
    childMax: `max by (pod,node,container,device) (max_over_time(container_fs_writes_bytes_total{${RAW_CHILD_SELECTOR}}[${range}]))`,
    networkReceiveMax: `max by (pod,node,interface) (max_over_time(container_network_receive_bytes_total{${RAW_NETWORK_SELECTOR}}[${range}]))`,
    networkTransmitMax: `max by (pod,node,interface) (max_over_time(container_network_transmit_bytes_total{${RAW_NETWORK_SELECTOR}}[${range}]))`,
    networkReceiveResets: `max by (pod,node,interface) (resets(container_network_receive_bytes_total{${RAW_NETWORK_SELECTOR}}[${range}]))`,
    networkTransmitResets: `max by (pod,node,interface) (resets(container_network_transmit_bytes_total{${RAW_NETWORK_SELECTOR}}[${range}]))`,
  };
}

function recordingQueries(range: string): IoQueries {
  return {
    parentMax: `max_over_time(buildkite:pod_parent_fs_writes_bytes_total{${RECORDING_SELECTOR}}[${range}])`,
    parentSamples: `count_over_time(buildkite:pod_parent_sample_present{${RECORDING_SELECTOR}}[${range}])`,
    // Query the underlying cAdvisor series even in recording mode. A
    // recording-rule evaluation timestamp only proves that the rule ran; it
    // does not prove that cAdvisor scraped the final device counter.
    parentLastSample: parentLastSampleQuery(range),
    parentResets: `resets(buildkite:pod_parent_fs_writes_bytes_total{${RECORDING_SELECTOR}}[${range}])`,
    childMax: `max_over_time(buildkite:container_fs_writes_bytes_total{${RECORDING_SELECTOR},container!=""}[${range}])`,
    networkReceiveMax: `max by (pod,node,interface) (max_over_time(container_network_receive_bytes_total{${RAW_NETWORK_SELECTOR}}[${range}]))`,
    networkTransmitMax: `max by (pod,node,interface) (max_over_time(container_network_transmit_bytes_total{${RAW_NETWORK_SELECTOR}}[${range}]))`,
    networkReceiveResets: `max by (pod,node,interface) (resets(container_network_receive_bytes_total{${RAW_NETWORK_SELECTOR}}[${range}]))`,
    networkTransmitResets: `max by (pod,node,interface) (resets(container_network_transmit_bytes_total{${RAW_NETWORK_SELECTOR}}[${range}]))`,
  };
}

export function buildIoQueries(
  window: TimeWindow,
  source: MetricSource,
): IoQueries {
  const range = `${String(durationSeconds(window))}s`;
  return source === "raw" ? rawQueries(range) : recordingQueries(range);
}

function metricValue(item: PrometheusVector[number]): number {
  return MetricValueSchema.parse(item.value[1]);
}

function metadataFromLabels(
  labels: z.infer<typeof RecordingMetadataLabelsSchema>,
): MetricMetadata {
  return {
    jobUuid: labels.label_buildkite_com_job_uuid,
    stepKey: labels.label_ci_sjer_red_step_key,
    branch: labels.annotation_buildkite_com_build_branch,
    buildUrl: labels.annotation_buildkite_com_build_url,
    jobUrl: labels.annotation_buildkite_com_job_url,
    pipeline: labels.annotation_buildkite_com_pipeline_slug,
  };
}

function parseParentMetrics(
  vector: PrometheusVector,
  source: MetricSource,
): DeviceMetric[] {
  return vector.map((item) => {
    if (source === "raw") {
      const labels = RawParentLabelsSchema.parse(item.metric);
      return {
        pod: labels.pod,
        node: labels.node,
        device: labels.device ?? null,
        value: metricValue(item),
        metadata: null,
      };
    }
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

function parseChildMetrics(
  vector: PrometheusVector,
  source: MetricSource,
): ChildDeviceMetric[] {
  return vector.map((item) => {
    if (source === "raw") {
      const labels = RawChildLabelsSchema.parse(item.metric);
      return {
        pod: labels.pod,
        node: labels.node,
        device: labels.device ?? null,
        container: labels.container,
        value: metricValue(item),
        metadata: null,
      };
    }
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
  source: MetricSource;
}): Promise<PrometheusIoMetrics> {
  const queries = buildIoQueries(input.window, input.source);
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
    parentMax: parseParentMetrics(parentMax, input.source),
    parentSamples: parseParentMetrics(parentSamples, input.source),
    // The timestamp query intentionally uses raw cAdvisor labels for both
    // metric modes; enriched recording metadata comes from parentMax.
    parentLastSample: parseParentMetrics(parentLastSample, "raw"),
    parentResets: parseParentMetrics(parentResets, input.source),
    childMax: parseChildMetrics(childMax, input.source),
    networkReceiveMax: parseNetworkMetrics(networkReceiveMax),
    networkTransmitMax: parseNetworkMetrics(networkTransmitMax),
    networkReceiveResets: parseNetworkMetrics(networkReceiveResets),
    networkTransmitResets: parseNetworkMetrics(networkTransmitResets),
  };
}
