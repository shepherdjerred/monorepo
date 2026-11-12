import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createGickupApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "gickup",
    namespace: "gickup",
    syncPolicy: {
      automated: { enabled: true },
    },
  });
}
