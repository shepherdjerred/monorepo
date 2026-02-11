import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";

export function createOpenclawApp(chart: Chart) {
  return new Application(chart, "openclaw-app", {
    metadata: {
      name: "openclaw",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~1.0.0-0",
        chart: "openclaw",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "openclaw",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
