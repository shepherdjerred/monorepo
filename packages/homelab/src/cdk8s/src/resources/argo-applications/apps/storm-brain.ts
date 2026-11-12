import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createStormBrainApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "storm-brain",
    namespace: "storm-brain",
    syncPolicy: {
      automated: {},
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
