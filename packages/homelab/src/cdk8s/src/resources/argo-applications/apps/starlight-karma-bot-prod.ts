import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createStarlightKarmaBotProdApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "starlight-karma-bot-prod",
    namespace: "starlight-karma-bot-prod",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
