import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { applicationProject } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/projects.ts";

export function createRedlibApp(chart: Chart) {
  return new Application(chart, "redlib-app", {
    metadata: {
      name: "redlib",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: applicationProject("redlib"),
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "redlib",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "redlib",
      },
      syncPolicy: {
        automated: { enabled: true },
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
