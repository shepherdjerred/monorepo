import { Size, type Chart } from "cdk8s";
import { Cpu, EnvValue } from "cdk8s-plus-31";
import {
  IntOrString,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { dnsEgressRule } from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { createTemporalDomainWorker } from "@shepherdjerred/homelab/cdk8s/src/resources/temporal/workers/domain-worker.ts";

/** Deterministic orchestration has no provider, vault, API or Kubernetes authority. */
export function createDeliveryWorkflowWorker(
  chart: Chart,
  serverServiceName: string,
) {
  const deployment = createTemporalDomainWorker(chart, {
    name: "temporal-delivery-workflows",
    component: "delivery-workflows",
    featureFlagsEnabled: false,
    cpuRequest: Cpu.millis(100),
    cpuLimit: Cpu.millis(1000),
    memoryRequest: Size.mebibytes(256),
    memoryLimit: Size.gibibytes(1),
    envVariables: {
      TEMPORAL_ADDRESS: EnvValue.fromValue(`${serverServiceName}:7233`),
      TEMPORAL_NAMESPACE: EnvValue.fromValue("prod"),
      TEMPORAL_WORKER_ROLE: EnvValue.fromValue("delivery-workflows"),
      TEMPORAL_METRICS_ADDRESS: EnvValue.fromValue("0.0.0.0:9464"),
      ENVIRONMENT: EnvValue.fromValue("production"),
    },
  });
  new KubeNetworkPolicy(chart, "delivery-workflows-network", {
    spec: {
      podSelector: { matchLabels: { component: "delivery-workflows" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "prometheus" },
              },
            },
          ],
          ports: [9464, 9465].map((port) => ({
            port: IntOrString.fromNumber(port),
            protocol: "TCP",
          })),
        },
      ],
      egress: [
        dnsEgressRule(),
        {
          to: [{ podSelector: { matchLabels: { app: "temporal-server" } } }],
          ports: [{ port: IntOrString.fromNumber(7233), protocol: "TCP" }],
        },
      ],
    },
  });
  return deployment;
}
