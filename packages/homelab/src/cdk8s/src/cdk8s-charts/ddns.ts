import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { createDdnsDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/ddns.ts";
import { createFirstPartyNetworkPolicies } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/workload-parts.ts";
import {
  dnsEgressRule,
  externalHttpsEgressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

export function createDdnsChart(app: App) {
  const chart = new Chart(app, "ddns", {
    namespace: "ddns",
    disableResourceNameHashes: true,
  });

  createDdnsDeployment(chart);

  // Both updaters serve nothing. They learn the public address from
  // Cloudflare's trace endpoint and write records through the Cloudflare
  // API, both over HTTPS.
  createFirstPartyNetworkPolicies(
    chart,
    [
      {
        name: "ddns-netpol",
        selects: "namespace",
        ingress: [],
        egress: [dnsEgressRule(), externalHttpsEgressRule()],
      },
    ],
    undefined,
  );
}
