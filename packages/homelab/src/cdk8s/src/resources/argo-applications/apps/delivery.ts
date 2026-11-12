import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createDeliveryApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "delivery",
    namespace: "delivery",
    syncPolicy: {
      automated: { enabled: false },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
