import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createPhoenixApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "phoenix",
    namespace: "phoenix",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
