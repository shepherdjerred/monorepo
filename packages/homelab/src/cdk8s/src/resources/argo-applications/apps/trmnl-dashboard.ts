import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createTrmnlDashboardApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "trmnl-dashboard",
    namespace: "trmnl-dashboard",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
