import type { Chart } from "cdk8s";
import {
  argoApplication,
  FIRST_PARTY_CHART_REPOSITORY,
  FIRST_PARTY_CHART_REVISION,
} from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";
import { CHARTS_ACTIVE } from "@shepherdjerred/homelab/cdk8s/src/resources/charts/index.ts";

/**
 * Staged OCI bootstrap: while `woodpecker/prod` rolls out `DOCKERHUB_PUBLISH`
 * on `helm-push` and `tofu-dockerhub/prod` creates `shepherdjerred/charts-bootstrap`
 * (and while `chartmuseum` remains live as a fallback), `charts` consumes
 * `charts-bootstrap` over HTTP; Wave 4 flips this `repoUrl` to
 * `registry-1.docker.io/shepherdjerred` before retiring `chartmuseum`.
 */
export function createChartsApp(chart: Chart, active = CHARTS_ACTIVE) {
  if (!active) return;
  return argoApplication(chart, {
    name: "charts",
    namespace: "charts",
    source: {
      repoUrl: FIRST_PARTY_CHART_REPOSITORY,
      chart: "charts-bootstrap",
      targetRevision: FIRST_PARTY_CHART_REVISION,
    },
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
