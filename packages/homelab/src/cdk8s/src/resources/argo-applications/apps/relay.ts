import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createRelayApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "relay",
    namespace: "relay",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
