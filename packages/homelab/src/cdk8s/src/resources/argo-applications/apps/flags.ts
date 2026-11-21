import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";
import { FLAGS_ACTIVE } from "@shepherdjerred/homelab/cdk8s/src/resources/flags/index.ts";

export function createFlagsApp(chart: Chart, active = FLAGS_ACTIVE) {
  if (!active) return;
  return createFirstPartyApplication(chart, {
    name: "flags",
    namespace: "flags",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
