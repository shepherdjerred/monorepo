import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { applicationProject } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/projects.ts";

export function createTrmnlDashboardApp(chart: Chart) {
  return new Application(chart, "trmnl-dashboard-app", {
    metadata: {
      name: "trmnl-dashboard",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: applicationProject("trmnl-dashboard"),
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "trmnl-dashboard",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "trmnl-dashboard",
      },
      syncPolicy: {
        automated: { enabled: true },
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
