import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";

export function createGolinkApp(chart: Chart) {
  return new Application(chart, "golink-app", {
    metadata: {
      name: "golink",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~1.0.0-0",
        chart: "golink",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "golink",
      },
      syncPolicy: {
        automated: {},
      },
    },
  });
}
