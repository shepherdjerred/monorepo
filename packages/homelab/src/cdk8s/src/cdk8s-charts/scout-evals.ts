import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import {
  KubeNetworkPolicy,
  IntOrString,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { createScoutEvalsDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/scout-evals.ts";

export function createScoutEvalsChart(app: App) {
  const chart = new Chart(app, "scout-evals", {
    namespace: "scout-evals",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "scout-evals-namespace", {
    metadata: {
      name: "scout-evals",
    },
  });

  createScoutEvalsDeployment(chart);

  // NetworkPolicy: allow ingress from Tailscale only (the app has no auth —
  // the tailnet is the trust boundary), plus the blackbox health probe.
  new KubeNetworkPolicy(chart, "scout-evals-ingress-netpol", {
    metadata: { name: "scout-evals-ingress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress"],
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "tailscale" },
              },
            },
          ],
        },
        // Allow blackbox-exporter's in-cluster health probe (http service port
        // only — not every port on the pod)
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "prometheus" },
              },
            },
          ],
          ports: [{ port: IntOrString.fromNumber(7341), protocol: "TCP" }],
        },
      ],
    },
  });

  // NetworkPolicy: DNS-only egress — the server reads/writes local SQLite and
  // makes no outbound calls (materialization runs on operator machines).
  new KubeNetworkPolicy(chart, "scout-evals-egress-netpol", {
    metadata: { name: "scout-evals-egress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Egress"],
      egress: [
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
      ],
    },
  });
}
