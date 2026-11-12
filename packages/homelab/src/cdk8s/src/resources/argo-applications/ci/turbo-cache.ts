import type { Chart } from "cdk8s";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createTurboCacheApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "turbo-cache",
    namespace: "turbo-cache",
    syncPolicy: {
      // prune is generally avoided across this repo's Applications, but
      // everything turbo-cache owns is disposable CI cache infrastructure
      // (deployment, service, NVMe cache PVC, secret refs) — the worst a
      // prune can do is delete something the next sync recreates. Without
      // it, a resource removed from the chart (the R2 OnePasswordItem
      // dropped by the write-reduction cutover) orphans forever: the app
      // reports OutOfSync on every reconcile and the argocd-sync step's
      // tree-health-wait times out on every main build (build 6322).
      automated: { enabled: true, prune: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
