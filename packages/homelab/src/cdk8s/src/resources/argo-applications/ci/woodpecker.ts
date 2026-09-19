import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { WOODPECKER_NAMESPACE } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/woodpecker-credentials.ts";

export function createWoodpeckerApp(chart: Chart) {
  return new Application(chart, "woodpecker-app", {
    metadata: {
      name: "woodpecker",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "woodpecker",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: WOODPECKER_NAMESPACE,
      },
      syncPolicy: {
        automated: { enabled: true },
        syncOptions: ["CreateNamespace=true", "ServerSideApply=true"],
      },
    },
  });
}
