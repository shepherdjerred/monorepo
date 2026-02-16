import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";

export function createPostalApp(chart: Chart) {
  return new Application(chart, "postal-app", {
    metadata: {
      name: "postal",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~1.0.0-0",
        chart: "postal",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "postal",
      },
      syncPolicy: {
        automated: {},
      },
    },
  });
}
