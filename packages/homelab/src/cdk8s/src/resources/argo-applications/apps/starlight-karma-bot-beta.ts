import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createStarlightKarmaBotBetaApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "starlight-karma-bot-beta",
    namespace: "starlight-karma-bot-beta",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
