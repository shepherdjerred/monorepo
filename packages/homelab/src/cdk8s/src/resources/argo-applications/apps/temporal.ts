import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createTemporalApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "temporal",
    namespace: "temporal",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
