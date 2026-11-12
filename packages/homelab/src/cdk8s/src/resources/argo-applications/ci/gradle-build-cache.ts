import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createGradleBuildCacheApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "gradle-build-cache",
    namespace: "gradle-build-cache",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
