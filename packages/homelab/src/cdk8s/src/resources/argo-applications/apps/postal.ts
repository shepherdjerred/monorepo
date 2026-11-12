import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createPostalApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "postal",
    namespace: "postal",
    syncPolicy: {
      automated: { enabled: true },
    },
  });
}
