import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createCloudflareTunnelApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "cloudflare-tunnel",
    namespace: "cloudflare-tunnel",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
