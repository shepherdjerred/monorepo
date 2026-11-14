import type { Chart } from "cdk8s";
import { KubeNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  dnsEgressRule,
  nsPeer,
  tcp,
  otlpEgress,
  seaweedfsEgress,
  prometheusIngressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { PROMETHEUS_GATEWAY_PORT } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/observability/monitoring-auth-gateways.ts";
import { monitoringEgress } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/workers/worker-network-policies.ts";

/**
 * Record the agent worker's narrow topology independently from the broad infra
 * worker policy. NetworkPolicy is not enforced until the switch described in
 * the wiki page `explanation/homelab/network-policy-enforcement`, and then
 * only once the `temporal` namespace is cut over; provider-to-Temporal denial
 * is enforced by the pod-local uid firewall.
 */
export function createTemporalAgentWorkerNetworkPolicy(chart: Chart): void {
  new KubeNetworkPolicy(chart, "temporal-agent-worker-netpol", {
    metadata: { name: "temporal-agent-worker-netpol" },
    spec: {
      podSelector: {
        matchLabels: { component: "agent-worker" },
      },
      policyTypes: ["Ingress", "Egress"],
      ingress: [prometheusIngressRule([9464, 9465])],
      egress: [
        dnsEgressRule(),
        {
          to: [
            {
              podSelector: {
                matchLabels: { app: "temporal-server" },
              },
            },
          ],
          ports: [tcp(7233)],
        },
        monitoringEgress(PROMETHEUS_GATEWAY_PORT),
        {
          to: [nsPeer("alert-dashboard")],
          ports: [tcp(7341)],
        },
        otlpEgress(),
        seaweedfsEgress(),
        // Flipt egress (8080, for temporalFeatureFlagEnvironment()'s
        // temporal-call-graph-tracing check) is granted by the shared
        // temporal-workers-flipt-egress policy in worker-network-policies.ts,
        // which already selects component=agent-worker.
        // Provider APIs, GitHub, registry metadata, and the Kubernetes API.
        { ports: [tcp(443)] },
        { ports: [tcp(6443)] },
      ],
    },
  });
}
