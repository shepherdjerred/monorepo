import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createMediaApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "media",
    namespace: "media",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["ServerSideApply=true"],
    },
  });
}
