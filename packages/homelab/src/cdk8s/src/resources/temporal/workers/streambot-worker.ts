import { Size, type Chart } from "cdk8s";
import { Cpu, EnvValue } from "cdk8s-plus-31";
import {
  IntOrString,
  KubeNetworkPolicy,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { createTemporalDomainWorker } from "./domain-worker.ts";
import { streambotSchedulerSecret } from "@shepherdjerred/homelab/cdk8s/src/resources/streambot/scheduling.ts";
import { dnsEgressRule } from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

export function createStreambotWorker(chart: Chart, serverServiceName: string) {
  const secret = streambotSchedulerSecret(chart);
  createTemporalDomainWorker(chart, {
    name: "temporal-streambot-worker",
    component: "streambot-worker",
    featureFlagsEnabled: false,
    cpuRequest: Cpu.millis(100),
    cpuLimit: Cpu.millis(500),
    memoryRequest: Size.mebibytes(256),
    memoryLimit: Size.mebibytes(512),
    envVariables: {
      TEMPORAL_ADDRESS: EnvValue.fromValue(`${serverServiceName}:7233`),
      TEMPORAL_NAMESPACE: EnvValue.fromValue("prod"),
      TEMPORAL_WORKER_ROLE: EnvValue.fromValue("streambot"),
      TEMPORAL_METRICS_ADDRESS: EnvValue.fromValue("0.0.0.0:9464"),
      FEATURE_FLAGS_MODE: EnvValue.fromValue("disabled"),
      ENVIRONMENT: EnvValue.fromValue("production"),
      STREAMBOT_INTERNAL_URL: EnvValue.fromValue(
        "http://streambot-scheduler.media.svc.cluster.local:8081",
      ),
      STREAMBOT_SCHEDULER_TOKEN: EnvValue.fromSecretValue({
        secret,
        key: "password",
      }),
    },
  });
  new KubeNetworkPolicy(chart, "temporal-streambot-worker-netpol", {
    metadata: { name: "temporal-streambot-worker-netpol" },
    spec: {
      podSelector: { matchLabels: { component: "streambot-worker" } },
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
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "media" },
              },
              podSelector: { matchLabels: { app: "streambot" } },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(8081), protocol: "TCP" }],
        },
      ],
    },
  });
}
