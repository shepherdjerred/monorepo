import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createScoutBetaApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "scout-beta",
    namespace: "scout-beta",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
