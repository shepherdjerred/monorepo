import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";

export function createBuildkitdApp(chart: Chart) {
  return new Application(chart, "buildkitd-app", {
    metadata: {
      name: "buildkitd",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "buildkitd",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "buildkitd",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true", "ServerSideApply=true"],
      },
    },
  });
}
