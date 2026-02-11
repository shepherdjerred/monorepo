import { Chart } from "cdk8s";
import type { App } from "cdk8s";
import { createScoutDeployment } from "../resources/scout/index.ts";
import { Namespace } from "cdk8s-plus-31";
import { KubeNetworkPolicy, IntOrString } from "../../generated/imports/k8s.ts";

export type Stage = "prod" | "beta";

export function createScoutChart(app: App, stage: Stage) {
  const chart = new Chart(app, `scout-${stage}`, {
    namespace: `scout-${stage}`,
    disableResourceNameHashes: true,
  });

  new Namespace(chart, `scout-${stage}-namespace`, {
    metadata: {
      name: `scout-${stage}`,
    },
  });

  createScoutDeployment(chart, stage);

  // NetworkPolicy: Allow ingress from Prometheus only (internal Discord bot, no external ingress)
  new KubeNetworkPolicy(chart, "scout-ingress-netpol", {
    metadata: { name: "scout-ingress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress"],
      ingress: [{ from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "prometheus" } } }] }],
    },
  });

  // NetworkPolicy: Allow egress to DNS, SeaweedFS S3, and external HTTPS
  new KubeNetworkPolicy(chart, "scout-egress-netpol", {
    metadata: { name: "scout-egress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Egress"],
      egress: [
        // DNS
        {
          to: [{ namespaceSelector: {}, podSelector: { matchLabels: { "k8s-app": "kube-dns" } } }],
          ports: [
            { port: IntOrString.fromNumber(53), protocol: "UDP" },
            { port: IntOrString.fromNumber(53), protocol: "TCP" },
          ],
        },
        // SeaweedFS S3 (seaweedfs-s3.seaweedfs.svc.cluster.local:8333)
        {
          to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "seaweedfs" } } }],
          ports: [{ port: IntOrString.fromNumber(8333), protocol: "TCP" }],
        },
        // External HTTPS (Riot API, Discord, Sentry, OpenAI, Gemini, ElevenLabs)
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: [{ port: IntOrString.fromNumber(443), protocol: "TCP" }],
        },
      ],
    },
  });
}
