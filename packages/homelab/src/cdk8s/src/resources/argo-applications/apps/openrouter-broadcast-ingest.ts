import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";

export function createOpenRouterBroadcastIngestApp(chart: Chart) {
  return new Application(chart, "openrouter-broadcast-ingest-app", {
    metadata: { name: "openrouter-broadcast-ingest" },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "openrouter-broadcast-ingest",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "openrouter-broadcast-ingest",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
