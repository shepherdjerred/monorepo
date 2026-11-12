import type { Chart } from "cdk8s";
import { WOODPECKER_NAMESPACE } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/woodpecker-credentials.ts";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createWoodpeckerApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "woodpecker",
    namespace: WOODPECKER_NAMESPACE,
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true", "ServerSideApply=true"],
    },
  });
}
