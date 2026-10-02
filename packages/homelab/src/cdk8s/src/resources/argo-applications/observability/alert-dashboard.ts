import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";

// Registered once the public image digest is pinned. Keep this application in
// the activation branch so ArgoCD owns the complete service lifecycle.
export function createAlertDashboardApp(chart: Chart) {
  return new Application(chart, "alert-dashboard-app", {
    metadata: {
      name: "alert-dashboard",
      // Accept the ops snapshot contract before Temporal Activities emit it.
      annotations: { "argocd.argoproj.io/sync-wave": "-2" },
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "alert-dashboard",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "alert-dashboard",
      },
      syncPolicy: {
        automated: { enabled: true },
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
