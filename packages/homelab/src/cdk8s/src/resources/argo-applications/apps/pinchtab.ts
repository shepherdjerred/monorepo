import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createPinchtabApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "pinchtab",
    namespace: "pinchtab",
    syncPolicy: {
      automated: { enabled: true },
    },
  });
}
