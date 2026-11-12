import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createTasknotesApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "tasknotes",
    namespace: "tasknotes",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
