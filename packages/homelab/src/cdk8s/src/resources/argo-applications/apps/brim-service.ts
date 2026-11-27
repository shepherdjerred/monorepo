import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";
import { BRIM_SERVICE_ACTIVE } from "@shepherdjerred/homelab/cdk8s/src/resources/brim-service/index.ts";

export function createBrimServiceApp(
  chart: Chart,
  active = BRIM_SERVICE_ACTIVE,
) {
  if (!active) return;
  return createFirstPartyApplication(chart, {
    name: "brim-service",
    namespace: "brim-service",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
