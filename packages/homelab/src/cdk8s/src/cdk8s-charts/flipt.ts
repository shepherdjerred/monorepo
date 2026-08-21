import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import {
  KubeNetworkPolicy,
  IntOrString,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  createFliptDeployment,
  FLIPT_PORT,
} from "@shepherdjerred/homelab/cdk8s/src/resources/flipt/index.ts";

export function createFliptChart(app: App) {
  const chart = new Chart(app, "flipt", {
    namespace: "flipt",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "flipt-namespace", {
    metadata: { name: "flipt" },
  });

  createFliptDeployment(chart);

  // Flipt runs with authentication disabled, so these policies ARE the access
  // boundary: reachability is the whole authorization model. Tailscale reaches
  // the UI, Prometheus scrapes metrics and runs the blackbox probe, and each
  // consumer namespace is added here as it adopts flags. Nothing else can talk
  // to it, in either direction.
  new KubeNetworkPolicy(chart, "flipt-ingress-netpol", {
    metadata: { name: "flipt-ingress-netpol" },
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
            {
              namespaceSelector: {
                matchLabels: { "kubernetes.io/metadata.name": "prometheus" },
              },
            },
          ],
          ports: [
            { port: IntOrString.fromNumber(FLIPT_PORT), protocol: "TCP" },
          ],
        },
      ],
    },
  });

  // DNS only. Storage is a local git repo on the PVC, there is no remote sync,
  // and both the update check and telemetry are disabled in the config — so
  // Flipt has no legitimate reason to reach the internet at all.
  new KubeNetworkPolicy(chart, "flipt-egress-netpol", {
    metadata: { name: "flipt-egress-netpol" },
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
