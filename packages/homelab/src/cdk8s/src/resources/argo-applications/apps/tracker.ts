import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createTrackerApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "tracker",
    namespace: "tracker",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
