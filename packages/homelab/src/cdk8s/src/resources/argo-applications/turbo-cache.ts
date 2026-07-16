import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";

export function createTurboCacheApp(chart: Chart) {
  return new Application(chart, "turbo-cache-app", {
    metadata: {
      name: "turbo-cache",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "turbo-cache",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "turbo-cache",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
