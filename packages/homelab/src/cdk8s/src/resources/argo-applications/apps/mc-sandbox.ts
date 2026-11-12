import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createMcSandboxApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "mc-sandbox",
    namespace: "mc-sandbox",
    syncPolicy: {
      automated: {},
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
