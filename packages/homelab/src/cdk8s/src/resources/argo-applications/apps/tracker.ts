import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { applicationProject } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/projects.ts";

export function createTrackerApp(chart: Chart) {
  return new Application(chart, "tracker-app", {
    metadata: { name: "tracker" },
    spec: {
      revisionHistoryLimit: 5,
      project: applicationProject("tracker"),
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "tracker",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "tracker",
      },
      syncPolicy: {
        automated: { enabled: true },
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
