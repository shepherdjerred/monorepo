import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createFreshrssApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "freshrss",
    namespace: "freshrss",
    syncPolicy: {
      automated: { enabled: true },
    },
  });
}
