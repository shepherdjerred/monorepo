import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";
import { ARTIFACTS_ACTIVE } from "@shepherdjerred/homelab/cdk8s/src/resources/artifacts/index.ts";

export function createArtifactsApp(chart: Chart, active = ARTIFACTS_ACTIVE) {
  if (!active) return;
  return createFirstPartyApplication(chart, {
    name: "artifacts",
    namespace: "artifacts",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
