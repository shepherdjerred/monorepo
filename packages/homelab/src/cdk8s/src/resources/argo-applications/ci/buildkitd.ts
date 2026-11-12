import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createBuildkitdApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "buildkitd",
    namespace: "buildkitd",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true", "ServerSideApply=true"],
    },
  });
}
