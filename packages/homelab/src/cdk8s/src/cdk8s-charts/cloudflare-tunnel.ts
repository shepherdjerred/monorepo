import { App, Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { createCloudflareTunnelCRD } from "../resources/cloudflare-tunnel.ts";

export function createCloudflareTunnelChart(app: App) {
  const chart = new Chart(app, "cloudflare-tunnel", {
    namespace: "cloudflare-tunnel",
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "cloudflare-tunnel-namespace", {
    metadata: {
      name: "cloudflare-tunnel",
    },
  });

  // ClusterTunnel is cluster-scoped, but we still need a chart to manage it
  createCloudflareTunnelCRD(chart);
}
