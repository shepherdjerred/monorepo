import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";

export function createTrackerTrackerApp(chart: Chart) {
  return new Application(chart, "tracker-tracker-app", {
    metadata: {
      name: "tracker-tracker",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "tracker-tracker",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "tracker-tracker",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
