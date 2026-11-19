import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { createGolinkDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/golink.ts";
import { createFirstPartyNetworkPolicies } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/workload-parts.ts";
import {
  dnsEgressRule,
  externalHttpsEgressRule,
  tcp,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

export function createGolinkChart(app: App) {
  const chart = new Chart(app, "golink", {
    namespace: "golink",
    disableResourceNameHashes: true,
  });

  createGolinkDeployment(chart);

  // golink is its own tailnet node (tsnet), not a Service behind the
  // Tailscale operator, so no pod connects to it. Its clients arrive over
  // WireGuard, which the node initiates outbound: Tailscale needs no inbound
  // port. Outbound it needs the coordination server and DERP relays (HTTPS,
  // and HTTP for DERP's captive-portal check), STUN, and WireGuard to peers,
  // which listen on arbitrary UDP ports.
  createFirstPartyNetworkPolicies(
    chart,
    [
      {
        name: "golink-netpol",
        selects: "namespace",
        ingress: [],
        egress: [
          dnsEgressRule(),
          externalHttpsEgressRule(),
          { to: [{ ipBlock: { cidr: "0.0.0.0/0" } }], ports: [tcp(80)] },
          {
            to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
            ports: [{ protocol: "UDP" }],
          },
        ],
      },
    ],
    undefined,
  );
}
