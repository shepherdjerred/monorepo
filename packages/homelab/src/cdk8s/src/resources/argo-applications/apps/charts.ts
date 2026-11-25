import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";
import { CHARTS_ACTIVE } from "@shepherdjerred/homelab/cdk8s/src/resources/charts/index.ts";

/**
 * Self-bootstrap invariant: during initial activation ChartMuseum still serves
 * FIRST_PARTY_CHART_REPOSITORY. Before cutting FIRST_PARTY_CHART_REPOSITORY
 * over from ChartMuseum to `charts`, move `charts`'s own chart source off
 * FIRST_PARTY_CHART_REPOSITORY (OCI on Docker Hub or direct bootstrap manifests)
 * so recovering `charts` never requires `charts` itself to already be up.
 */
export function createChartsApp(chart: Chart, active = CHARTS_ACTIVE) {
  if (!active) return;
  return createFirstPartyApplication(chart, {
    name: "charts",
    namespace: "charts",
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
