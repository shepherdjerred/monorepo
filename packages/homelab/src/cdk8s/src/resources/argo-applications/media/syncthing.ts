import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createSyncthingApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "syncthing",
    namespace: "syncthing",
    syncPolicy: {
      automated: { enabled: true },
    },
  });
}
