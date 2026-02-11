import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";

export function createMediaApp(chart: Chart) {
  return new Application(chart, "media-app", {
    metadata: {
      name: "media",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~1.0.0-0",
        chart: "media",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "media",
      },
      syncPolicy: {
        automated: {},
      },
    },
  });
}
