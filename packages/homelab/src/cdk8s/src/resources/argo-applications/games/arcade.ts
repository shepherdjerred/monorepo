import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createArcadeApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "arcade",
    namespace: "arcade",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
