import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";

export function createTurboCacheApp(chart: Chart) {
  return new Application(chart, "turbo-cache-app", {
    metadata: {
      name: "turbo-cache",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "turbo-cache",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "turbo-cache",
      },
      syncPolicy: {
        // prune is generally avoided across this repo's Applications, but
        // everything turbo-cache owns is disposable CI cache infrastructure
        // (deployment, service, NVMe cache PVC, secret refs) — the worst a
        // prune can do is delete something the next sync recreates. Without
        // it, a resource removed from the chart (the R2 OnePasswordItem
        // dropped by the write-reduction cutover) orphans forever: the app
        // reports OutOfSync on every reconcile and the argocd-sync step's
        // tree-health-wait times out on every main build (build 6322).
        automated: { prune: true },
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
