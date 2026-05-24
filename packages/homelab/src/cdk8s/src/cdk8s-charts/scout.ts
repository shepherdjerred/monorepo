import { Chart } from "cdk8s";
import type { App } from "cdk8s";
import { createScoutDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/scout/index.ts";
import { createScoutAppDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/scout/app.ts";
import { Namespace } from "cdk8s-plus-31";
import {
  KubeNetworkPolicy,
  IntOrString,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";

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
  createScoutAppDeployment(chart, stage);

  // NetworkPolicy: Allow ingress from Prometheus (scrapes scout-backend
  // metrics on :3000), in-namespace pods (scout-app → scout-backend on
  // :3000 for /trpc + /api proxying), and Cloudflare Tunnel pods (the
  // CF Tunnel binding routes scout-for-lol.com → scout-app on :80).
  new KubeNetworkPolicy(chart, "scout-ingress-netpol", {
    metadata: { name: "scout-ingress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "prometheus" },
              },
            },
            { podSelector: {} },
            {
              namespaceSelector: {
                matchLabels: {
                  "kubernetes.io/metadata.name": "cloudflare-operator-system",
                },
              },
            },
          ],
        },
      ],
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
          to: [
            {
              namespaceSelector: {},
              podSelector: { matchLabels: { "k8s-app": "kube-dns" } },
            },
          ],
          ports: [
            { port: IntOrString.fromNumber(53), protocol: "UDP" },
            { port: IntOrString.fromNumber(53), protocol: "TCP" },
          ],
        },
        // SeaweedFS S3 (seaweedfs-s3.seaweedfs.svc.cluster.local:8333)
        {
          to: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "seaweedfs" },
              },
            },
          ],
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
