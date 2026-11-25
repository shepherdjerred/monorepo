import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";
import { FEEDS_ACTIVE } from "@shepherdjerred/homelab/cdk8s/src/resources/feeds/index.ts";

export function createFeedsApp(chart: Chart, active = FEEDS_ACTIVE) {
  if (!active) return;
  return createFirstPartyApplication(chart, {
    name: "feeds",
    namespace: "feeds",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
