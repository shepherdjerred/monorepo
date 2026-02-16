import { App, Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { KubeNetworkPolicy, IntOrString } from "../../generated/imports/k8s.ts";
import { createBirmelDeployment } from "../resources/birmel/index.ts";

export function createBirmelChart(app: App) {
  const chart = new Chart(app, "birmel", {
    namespace: "birmel",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "birmel-namespace", {
    metadata: {
      name: "birmel",
    },
  });

  createBirmelDeployment(chart);

  // NetworkPolicy: Allow ingress from Tailscale (handles both studio:4111 and funnel oauth:4112)
  new KubeNetworkPolicy(chart, "birmel-ingress-netpol", {
    metadata: { name: "birmel-ingress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress"],
      ingress: [{ from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "tailscale" } } }] }],
    },
  });

  // NetworkPolicy: Allow egress to DNS, Tempo (OTLP), and external HTTPS
  new KubeNetworkPolicy(chart, "birmel-egress-netpol", {
    metadata: { name: "birmel-egress-netpol" },
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
        // Tempo OTLP (tempo.tempo.svc.cluster.local:4318)
        {
          to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "tempo" } } }],
          ports: [{ port: IntOrString.fromNumber(4318), protocol: "TCP" }],
        },
        // External HTTPS (Discord, OpenAI, Anthropic, GitHub, Sentry)
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: [{ port: IntOrString.fromNumber(443), protocol: "TCP" }],
        },
      ],
    },
  });
}
