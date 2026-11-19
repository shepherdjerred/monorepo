import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { createGickupDeployment } from "@shepherdjerred/homelab/cdk8s/src/resources/gickup.ts";
import { createFirstPartyNetworkPolicies } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/workload-parts.ts";
import {
  dnsEgressRule,
  externalHttpsEgressRule,
  prometheusIngressRule,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";

export async function createGickupChart(app: App) {
  const chart = new Chart(app, "gickup", {
    namespace: "gickup",
    disableResourceNameHashes: true,
  });

  await createGickupDeployment(chart);

  // Prometheus scrapes the metrics listener. Every source in
  // `configs/gickup.yml` is GitHub over HTTPS (API, clones, LFS), and the
  // only destination is the local claim.
  createFirstPartyNetworkPolicies(
    chart,
    [
      {
        name: "gickup-netpol",
        selects: "namespace",
        ingress: [prometheusIngressRule([6178])],
        egress: [dnsEgressRule(), externalHttpsEgressRule()],
      },
    ],
    undefined,
  );
}
