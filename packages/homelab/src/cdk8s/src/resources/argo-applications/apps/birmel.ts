import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createBirmelApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "birmel",
    namespace: "birmel",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
