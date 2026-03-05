import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";

export function createBazelRemoteApp(chart: Chart) {
  return new Application(chart, "bazel-remote-app", {
    metadata: {
      name: "bazel-remote",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~1.1.0-0",
        chart: "bazel-remote",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "bazel-remote",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
