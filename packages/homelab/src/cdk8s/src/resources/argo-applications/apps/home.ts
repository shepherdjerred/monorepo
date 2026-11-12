import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createHomeApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "home",
    namespace: "home",
    syncPolicy: {
      automated: { enabled: true },
    },
  });
}
