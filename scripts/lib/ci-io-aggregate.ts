import { z } from "zod";

import type {
  ChildDeviceMetric,
  DeviceMetric,
  MetricMetadata,
  NetworkMetric,
  PrometheusIoMetrics,
} from "./ci-io-prometheus.ts";

const JobUuidSchema = z.uuid();
const POD_NAME_PATTERN = /^buildkite-([0-9a-f-]{36})-[a-z0-9]+$/;

export type PodMeasurement = {
  pod: string;
  jobUuid: string;
  nodes: string[];
  writeBytes: number;
  sampleCount: number;
  resetCount: number;
  networkReceiveBytes: number | null;
  networkTransmitBytes: number | null;
  networkResetCount: number;
  componentWriteBytes: Record<string, number>;
  metadata: MetricMetadata | null;
  metadataConflicts: string[];
};

function podJobUuid(pod: string): string {
  const match = POD_NAME_PATTERN.exec(pod);
  if (match === null) {
    throw new Error(`invalid Buildkite pod name: ${pod}`);
  }
  return JobUuidSchema.parse(match[1]);
}

function deviceKey(metric: DeviceMetric): string {
  return JSON.stringify([metric.pod, metric.node, metric.device]);
}

function networkKey(metric: NetworkMetric): string {
  return `${metric.pod}\u0000${metric.node}\u0000${metric.networkInterface}`;
}

function childKey(metric: ChildDeviceMetric): string {
  return `${deviceKey(metric)}\u0000${metric.container}`;
}

function uniqueDeviceMap(
  metrics: DeviceMetric[],
  label: string,
): Map<string, DeviceMetric> {
  const indexed = new Map<string, DeviceMetric>();
  for (const metric of metrics) {
    const key = deviceKey(metric);
    if (indexed.has(key)) {
      throw new Error(`duplicate ${label} series for ${key}`);
    }
    indexed.set(key, metric);
  }
  return indexed;
}

function uniqueNetworkMap(
  metrics: NetworkMetric[],
  label: string,
): Map<string, NetworkMetric> {
  const indexed = new Map<string, NetworkMetric>();
  for (const metric of metrics) {
    const key = networkKey(metric);
    if (indexed.has(key)) {
      throw new Error(`duplicate ${label} series for ${key}`);
    }
    indexed.set(key, metric);
  }
  return indexed;
}

function uniqueChildren(
  metrics: ChildDeviceMetric[],
): Map<string, ChildDeviceMetric> {
  const indexed = new Map<string, ChildDeviceMetric>();
  for (const metric of metrics) {
    const key = childKey(metric);
    if (indexed.has(key)) {
      throw new Error(`duplicate child-write series for ${key}`);
    }
    indexed.set(key, metric);
  }
  return indexed;
}

function groupByPod<T extends { pod: string }>(items: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const current = grouped.get(item.pod) ?? [];
    current.push(item);
    grouped.set(item.pod, current);
  }
  return grouped;
}

function sameMetadata(left: MetricMetadata, right: MetricMetadata): boolean {
  return (
    left.jobUuid === right.jobUuid &&
    left.stepKey === right.stepKey &&
    left.branch === right.branch &&
    left.buildUrl === right.buildUrl &&
    left.jobUrl === right.jobUrl &&
    left.pipeline === right.pipeline
  );
}

function resolveMetadata(
  parents: DeviceMetric[],
  children: ChildDeviceMetric[],
): { metadata: MetricMetadata | null; conflicts: string[] } {
  const all = [...parents, ...children]
    .map((metric) => metric.metadata)
    .filter((metadata) => metadata !== null);
  const first = all[0] ?? null;
  if (first === null) {
    return { metadata: null, conflicts: [] };
  }
  const conflicts = all.some((metadata) => !sameMetadata(first, metadata))
    ? ["recording-rule metadata differs across pod series"]
    : [];
  return { metadata: first, conflicts };
}

function componentBytes(children: ChildDeviceMetric[]): Record<string, number> {
  const components = new Map<string, number>();
  for (const child of children) {
    components.set(
      child.container,
      (components.get(child.container) ?? 0) + child.value,
    );
  }
  return Object.fromEntries(
    [...components.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

function sumNetwork(metrics: NetworkMetric[]): number | null {
  if (metrics.length === 0) {
    return null;
  }
  return metrics.reduce((total, metric) => total + metric.value, 0);
}

function minSamples(
  parents: DeviceMetric[],
  samples: Map<string, DeviceMetric>,
): number {
  return parents.reduce((minimum, parent) => {
    const count = samples.get(deviceKey(parent))?.value ?? 0;
    return Math.min(minimum, count);
  }, Number.POSITIVE_INFINITY);
}

function sumResets(
  parents: DeviceMetric[],
  resets: Map<string, DeviceMetric>,
): number {
  return parents.reduce(
    (total, parent) => total + (resets.get(deviceKey(parent))?.value ?? 0),
    0,
  );
}

export function aggregatePodMetrics(
  input: PrometheusIoMetrics,
): PodMeasurement[] {
  const parents = uniqueDeviceMap(input.parentMax, "parent-write");
  const samples = uniqueDeviceMap(input.parentSamples, "parent-sample");
  const resets = uniqueDeviceMap(input.parentResets, "parent-reset");
  const children = uniqueChildren(input.childMax);
  const receive = uniqueNetworkMap(input.networkReceiveMax, "network-receive");
  const transmit = uniqueNetworkMap(
    input.networkTransmitMax,
    "network-transmit",
  );
  const receiveResets = uniqueNetworkMap(
    input.networkReceiveResets,
    "network-receive-reset",
  );
  const transmitResets = uniqueNetworkMap(
    input.networkTransmitResets,
    "network-transmit-reset",
  );

  const parentPods = groupByPod([...parents.values()]);
  const childPods = groupByPod([...children.values()]);
  const receivePods = groupByPod([...receive.values()]);
  const transmitPods = groupByPod([...transmit.values()]);
  const receiveResetPods = groupByPod([...receiveResets.values()]);
  const transmitResetPods = groupByPod([...transmitResets.values()]);

  return [...parentPods.entries()]
    .map(([pod, podParents]) => {
      const podChildren = childPods.get(pod) ?? [];
      const resolvedMetadata = resolveMetadata(podParents, podChildren);
      const networkResetCount = [
        ...(receiveResetPods.get(pod) ?? []),
        ...(transmitResetPods.get(pod) ?? []),
      ].reduce((total, metric) => total + metric.value, 0);
      return {
        pod,
        jobUuid: podJobUuid(pod),
        nodes: [...new Set(podParents.map((metric) => metric.node))].sort(),
        writeBytes: podParents.reduce(
          (total, metric) => total + metric.value,
          0,
        ),
        sampleCount: minSamples(podParents, samples),
        resetCount: sumResets(podParents, resets),
        networkReceiveBytes: sumNetwork(receivePods.get(pod) ?? []),
        networkTransmitBytes: sumNetwork(transmitPods.get(pod) ?? []),
        networkResetCount,
        componentWriteBytes: componentBytes(podChildren),
        metadata: resolvedMetadata.metadata,
        metadataConflicts: resolvedMetadata.conflicts,
      };
    })
    .sort((left, right) => left.pod.localeCompare(right.pod));
}
