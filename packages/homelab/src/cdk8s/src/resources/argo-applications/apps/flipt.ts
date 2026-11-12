import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createFliptApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "flipt",
    namespace: "flipt",
    metadata: {
      annotations: { "argocd.argoproj.io/sync-wave": "-2" },
    },
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
