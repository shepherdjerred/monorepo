import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";

export function createSentinelApp(chart: Chart) {
  return new Application(chart, "sentinel-app", {
    metadata: {
      name: "sentinel",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~1.1.0-0",
        chart: "sentinel",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "sentinel",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
