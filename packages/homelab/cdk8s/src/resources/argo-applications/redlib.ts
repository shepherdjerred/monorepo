import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";

export function createRedlibApp(chart: Chart) {
  return new Application(chart, "redlib-app", {
    metadata: {
      name: "redlib",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~1.0.0-0",
        chart: "redlib",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "redlib",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
