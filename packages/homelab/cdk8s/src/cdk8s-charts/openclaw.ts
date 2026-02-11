import { App, Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { KubeNetworkPolicy } from "../../generated/imports/k8s.ts";
import { createOpenclawDeployment } from "../resources/openclaw/index.ts";

export function createOpenclawChart(app: App) {
  const chart = new Chart(app, "openclaw", {
    namespace: "openclaw",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "openclaw-namespace", {
    metadata: {
      name: "openclaw",
      labels: {
        // Pod security standards - audit mode to avoid admission failures
        // (enforce requires seccompProfile and capabilities.drop which cdk8s-plus doesn't set by default)
        "pod-security.kubernetes.io/audit": "restricted",
        "pod-security.kubernetes.io/warn": "restricted",
      },
    },
  });

  createOpenclawDeployment(chart);

  // NetworkPolicy: Allow ingress from Tailscale only
  // Note: Egress policy already exists in resources/openclaw/index.ts (allows all except cloud metadata)
  new KubeNetworkPolicy(chart, "openclaw-ingress-netpol", {
    metadata: { name: "openclaw-ingress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress"],
      ingress: [{ from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "tailscale" } } }] }],
    },
  });
}
