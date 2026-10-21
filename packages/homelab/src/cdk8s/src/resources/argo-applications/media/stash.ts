import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { applicationProject } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/projects.ts";

export function createStashApp(chart: Chart) {
  return new Application(chart, "stash-app", {
    metadata: { name: "stash" },
    spec: {
      revisionHistoryLimit: 5,
      project: applicationProject("stash"),
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "stash",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "stash",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
