import { App, Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { KubeNetworkPolicy, IntOrString } from "../../generated/imports/k8s.ts";
import { createMcpGatewayDeployment } from "../resources/mcp-gateway/index.ts";

export async function createMcpGatewayChart(app: App) {
  const chart = new Chart(app, "mcp-gateway", {
    namespace: "mcp-gateway",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "mcp-gateway-namespace", {
    metadata: {
      name: "mcp-gateway",
    },
  });

  await createMcpGatewayDeployment(chart);

  // NetworkPolicy: Allow ingress from Tailscale only
  new KubeNetworkPolicy(chart, "mcp-gateway-ingress-netpol", {
    metadata: { name: "mcp-gateway-ingress-netpol" },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress"],
      ingress: [{ from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "tailscale" } } }] }],
    },
  });

  // NetworkPolicy: Allow egress to DNS and external HTTPS (npm registry, Canvas API, Todoist API)
  new KubeNetworkPolicy(chart, "mcp-gateway-egress-netpol", {
    metadata: { name: "mcp-gateway-egress-netpol" },
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
        // External HTTPS (npm registry, Canvas API, Todoist API)
        {
          to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
          ports: [{ port: IntOrString.fromNumber(443), protocol: "TCP" }],
        },
      ],
    },
  });
}
