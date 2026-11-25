import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";
import { ERRORS_ACTIVE } from "@shepherdjerred/homelab/cdk8s/src/resources/errors/index.ts";

export function createErrorsApp(chart: Chart, active = ERRORS_ACTIVE) {
  if (!active) return;
  return createFirstPartyApplication(chart, {
    name: "errors",
    namespace: "errors",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
