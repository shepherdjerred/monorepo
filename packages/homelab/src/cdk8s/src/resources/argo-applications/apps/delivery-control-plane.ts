import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createDeliveryControlPlaneApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "delivery-control-plane",
    namespace: "temporal",
    syncPolicy: {
      automated: { enabled: false },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
