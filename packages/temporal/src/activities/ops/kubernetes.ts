import type {
  NodeStatus,
  PodStatus,
} from "@shepherdjerred/ops-clients/kubernetes.ts";
import { METRIC_IDS } from "@shepherdjerred/ops-model/metric-ids.ts";
import type { Severity } from "@shepherdjerred/ops-model/severity.ts";
import type { SignalInput } from "@shepherdjerred/ops-model/snapshot.ts";
import { logsLink, metricsLink } from "./ops-links.ts";
import {
  metric,
  minutesSince,
  serviceForNamespace,
  type OpsCollection,
  type OpsContext,
} from "./ops-types.ts";

/** A Pending pod younger than this is a rollout in progress, not a problem. */
const PENDING_GRACE_MINUTES = 10;

/**
 * Severity of an unhealthy pod, or `undefined` when it should not be listed.
 * Stuck containers are errors; a failed or long-pending pod is a warning;
 * evicted pods are leftovers worth knowing about but not acting on.
 */
export function podSeverity(pod: PodStatus, now: Date): Severity | undefined {
  if (pod.problem === undefined) {
    return undefined;
  }
  if (pod.stuck) {
    return "error";
  }
  if (pod.problem === "Evicted") {
    return "info";
  }
  const rollingOut =
    pod.phase === "Pending" &&
    minutesSince(pod.createdAt, now) < PENDING_GRACE_MINUTES;
  return rollingOut ? undefined : "warning";
}

function nodeSignal(node: NodeStatus): SignalInput {
  return {
    id: `kubernetes:node:${node.name}`,
    source: "kubernetes",
    section: "platform",
    kind: "node",
    severity: "error",
    needsMe: false,
    title: `Node ${node.name} is not Ready`,
    ...(node.readySince === undefined ? {} : { since: node.readySince }),
    attributes: {
      osImage: node.osImage,
      kubeletVersion: node.kubeletVersion,
    },
    links: [
      metricsLink(
        `Node ${node.name} conditions`,
        `kube_node_status_condition{node="${node.name}",status="true"}`,
        "now-6h",
      ),
    ],
  };
}

export function mapKubernetes(
  nodes: readonly NodeStatus[],
  pods: readonly PodStatus[],
  context: OpsContext,
): OpsCollection {
  const signals: SignalInput[] = nodes
    .filter((node) => !node.ready)
    .map((node) => nodeSignal(node));
  let unhealthy = 0;
  for (const pod of pods) {
    const severity = podSeverity(pod, context.now);
    if (severity === undefined) {
      continue;
    }
    if (severity === "warning" || severity === "error") {
      unhealthy += 1;
    }
    signals.push({
      id: `kubernetes:pod:${pod.namespace}/${pod.name}`,
      source: "kubernetes",
      section: "platform",
      ...serviceForNamespace(context, pod.namespace),
      kind: "pod",
      severity,
      needsMe: false,
      title: `${pod.namespace}/${pod.name}: ${pod.problem ?? pod.phase}`,
      since: new Date(Date.parse(pod.createdAt)).toISOString(),
      attributes: {
        namespace: pod.namespace,
        phase: pod.phase,
        restarts: pod.restarts,
        ...(pod.ownerKind === undefined ? {} : { owner: pod.ownerKind }),
      },
      links: [logsLink(pod.namespace, pod.name)],
    });
  }
  const ready = nodes.filter((node) => node.ready).length;
  return {
    signals,
    metrics: [
      metric({
        section: "platform",
        source: "kubernetes",
        id: METRIC_IDS.nodesReady,
        label: "Nodes ready",
        value: ready,
        unit: "count",
        severity: ready < nodes.length ? "error" : "ok",
      }),
      metric({
        section: "platform",
        source: "kubernetes",
        id: METRIC_IDS.nodesTotal,
        label: "Nodes",
        value: nodes.length,
        unit: "count",
      }),
      metric({
        section: "platform",
        source: "kubernetes",
        id: METRIC_IDS.podsUnhealthy,
        label: "Unhealthy pods",
        value: unhealthy,
        unit: "count",
      }),
    ],
    changes: [],
  };
}
