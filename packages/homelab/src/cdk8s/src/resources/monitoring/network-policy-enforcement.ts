import type { Chart } from "cdk8s";
import {
  PodMonitor,
  PodMonitorSpecPodMetricsEndpointsRelabelingsAction,
  PrometheusRule,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import {
  ENFORCER_CONTAINER,
  ENFORCER_METRICS_PORT,
  ENFORCER_NAMESPACE,
  ENFORCER_POD_SELECTOR,
  getNetworkPolicyEnforcementRuleGroups,
} from "./monitoring/rules/platform/network-policy-enforcement.ts";

/**
 * Scrapes and alerts on the NetworkPolicy enforcer.
 *
 * The enforcer runs as the `kube-network-policies` container of the
 * Talos-rendered `kube-system/kube-flannel` DaemonSet, on the host network of
 * every node. Talos declares no container port for it, so the monitor cannot
 * select a port: it keeps the enforcer's container target and rewrites the
 * address to the pod (node) IP and the upstream default metrics port. Until
 * Talos adds the container, the monitor finds no target and the rules match
 * nothing.
 */
export function createNetworkPolicyEnforcementMonitoring(chart: Chart): void {
  new PodMonitor(chart, "kube-network-policies-pod-monitor", {
    metadata: {
      name: ENFORCER_CONTAINER,
      namespace: ENFORCER_NAMESPACE,
      labels: { release: "prometheus" },
    },
    spec: {
      namespaceSelector: { matchNames: [ENFORCER_NAMESPACE] },
      selector: { matchLabels: ENFORCER_POD_SELECTOR },
      podMetricsEndpoints: [
        {
          path: "/metrics",
          interval: "30s",
          relabelings: [
            {
              sourceLabels: ["__meta_kubernetes_pod_container_name"],
              regex: ENFORCER_CONTAINER,
              action: PodMonitorSpecPodMetricsEndpointsRelabelingsAction.KEEP,
            },
            {
              sourceLabels: ["__meta_kubernetes_pod_ip"],
              regex: "(.+)",
              targetLabel: "__address__",
              replacement: `$1:${String(ENFORCER_METRICS_PORT)}`,
              action:
                PodMonitorSpecPodMetricsEndpointsRelabelingsAction.REPLACE,
            },
            {
              sourceLabels: ["__meta_kubernetes_pod_node_name"],
              targetLabel: "node",
              action:
                PodMonitorSpecPodMetricsEndpointsRelabelingsAction.REPLACE,
            },
          ],
        },
      ],
    },
  });

  new PrometheusRule(chart, "prometheus-network-policy-enforcement-rules", {
    metadata: {
      name: "prometheus-network-policy-enforcement-rules",
      namespace: ENFORCER_NAMESPACE,
      labels: { release: "prometheus" },
    },
    spec: { groups: getNetworkPolicyEnforcementRuleGroups() },
  });
}
