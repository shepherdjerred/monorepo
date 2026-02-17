import type { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";

export function createScoutProdApp(chart: Chart) {
  return new Application(chart, "scout-prod-app", {
    metadata: {
      name: "scout-prod",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~1.0.0-0",
        chart: "scout-prod",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "scout-prod",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
