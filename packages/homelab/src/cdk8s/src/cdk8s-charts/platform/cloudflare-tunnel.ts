import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { createCloudflareTunnelCRD } from "@shepherdjerred/homelab/cdk8s/src/resources/cloudflare-tunnel.ts";

export function createCloudflareTunnelChart(app: App) {
  const chart = new Chart(app, "cloudflare-tunnel", {
    namespace: "cloudflare-operator-system",
    disableResourceNameHashes: true,
  });

  // ClusterTunnel is cluster-scoped, but we still need a chart to manage it
  createCloudflareTunnelCRD(chart);
}
