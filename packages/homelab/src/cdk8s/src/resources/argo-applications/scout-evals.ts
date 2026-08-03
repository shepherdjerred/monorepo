import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";

export function createScoutEvalsApp(chart: Chart) {
  return new Application(chart, "scout-evals-app", {
    metadata: {
      name: "scout-evals",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "scout-evals",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "scout-evals",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
