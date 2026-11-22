import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";
import { STORM_STATS_ACTIVE } from "@shepherdjerred/homelab/cdk8s/src/resources/storm-stats/index.ts";

export function createStormStatsApp(chart: Chart, active = STORM_STATS_ACTIVE) {
  if (!active) return;
  return createFirstPartyApplication(chart, {
    name: "storm-stats",
    namespace: "storm-stats",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
