import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createBugsinkApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "bugsink",
    namespace: "bugsink",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
