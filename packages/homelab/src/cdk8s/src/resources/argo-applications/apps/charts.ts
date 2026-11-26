import type { Chart } from "cdk8s";
import {
  argoApplication,
  FIRST_PARTY_CHART_REVISION,
} from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";
import { CHARTS_ACTIVE } from "@shepherdjerred/homelab/cdk8s/src/resources/charts/index.ts";

/**
 * Self-bootstrap invariant: `charts` pulls `charts-bootstrap` from public
 * Docker Hub OCI rather than `FIRST_PARTY_CHART_REPOSITORY` so recovering
 * `charts` never requires `charts` itself to already be up.
 */
export function createChartsApp(chart: Chart, active = CHARTS_ACTIVE) {
  if (!active) return;
  return argoApplication(chart, {
    name: "charts",
    namespace: "charts",
    source: {
      repoUrl: "registry-1.docker.io/shepherdjerred",
      chart: "charts-bootstrap",
      targetRevision: FIRST_PARTY_CHART_REVISION,
    },
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
