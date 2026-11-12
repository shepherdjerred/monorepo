import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createScoutProdApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "scout-prod",
    namespace: "scout-prod",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
