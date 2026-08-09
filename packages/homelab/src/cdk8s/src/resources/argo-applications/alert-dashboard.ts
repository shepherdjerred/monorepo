import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";

// Intentionally not registered in cdk8s-charts/apps.ts until the first real,
// public image digest is pinned. See packages/docs/todos/pagerduty-migration.md.
export function createAlertDashboardApp(chart: Chart) {
  return new Application(chart, "alert-dashboard-app", {
    metadata: { name: "alert-dashboard" },
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
      syncPolicy: { automated: {}, syncOptions: ["CreateNamespace=true"] },
    },
  });
}
