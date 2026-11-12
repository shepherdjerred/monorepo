import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createStashApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "stash",
    namespace: "stash",
    syncPolicy: {
      automated: {},
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
