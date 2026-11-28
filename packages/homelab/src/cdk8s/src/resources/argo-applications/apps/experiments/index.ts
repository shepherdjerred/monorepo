import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";
import { EXPERIMENTS_ACTIVE } from "@shepherdjerred/homelab/cdk8s/src/resources/experiments/index.ts";

export function createExperimentsApp(
  chart: Chart,
  active = EXPERIMENTS_ACTIVE,
) {
  if (!active) return;
  return createFirstPartyApplication(chart, {
    name: "experiments",
    namespace: "experiments",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
