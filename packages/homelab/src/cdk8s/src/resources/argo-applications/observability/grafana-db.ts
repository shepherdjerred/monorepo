import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createGrafanaDbApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "grafana-db",
    namespace: "prometheus",
    syncPolicy: {
      automated: { enabled: true },
    },
  });
}
