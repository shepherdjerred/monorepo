import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";

export function createPhoenixApp(chart: Chart) {
  return new Application(chart, "phoenix-app", {
    metadata: {
      name: "phoenix",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "phoenix",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "phoenix",
      },
      syncPolicy: {
        automated: { enabled: true },
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
