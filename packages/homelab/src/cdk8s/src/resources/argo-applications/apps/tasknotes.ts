import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { applicationProject } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/projects.ts";

export function createTasknotesApp(chart: Chart) {
  return new Application(chart, "tasknotes-app", {
    metadata: {
      name: "tasknotes",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: applicationProject("tasknotes"),
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "tasknotes",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "tasknotes",
      },
      syncPolicy: {
        automated: { enabled: true },
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
