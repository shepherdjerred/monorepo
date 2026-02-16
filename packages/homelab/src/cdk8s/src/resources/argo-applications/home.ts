import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";

export function createHomeApp(chart: Chart) {
  return new Application(chart, "home-app", {
    metadata: {
      name: "home",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~1.0.0-0",
        chart: "home",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "home",
      },
      syncPolicy: {
        automated: {},
      },
    },
  });
}
