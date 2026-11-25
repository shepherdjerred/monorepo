import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";
import { CI_CACHE_ACTIVE } from "@shepherdjerred/homelab/cdk8s/src/resources/ci-cache/index.ts";

export function createCiCacheApp(chart: Chart, active = CI_CACHE_ACTIVE) {
  if (!active) return;
  return createFirstPartyApplication(chart, {
    name: "ci-cache",
    namespace: "ci-cache",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
