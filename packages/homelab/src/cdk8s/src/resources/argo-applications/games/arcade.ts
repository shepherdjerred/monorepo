import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";

export function createArcadeApp(chart: Chart) {
  return new Application(chart, "arcade-app", {
    metadata: {
      name: "arcade",
      // Reconcile the stopped legacy owners before starting the shared owner.
      annotations: { "argocd.argoproj.io/sync-wave": "1" },
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "arcade",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "arcade",
      },
      syncPolicy: {
        automated: { enabled: true },
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
