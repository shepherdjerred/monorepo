import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";

export function createWindmillDbApp(chart: Chart) {
  return new Application(chart, "windmill-db-app", {
    metadata: {
      name: "windmill-db",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "windmill-db",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "windmill",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
