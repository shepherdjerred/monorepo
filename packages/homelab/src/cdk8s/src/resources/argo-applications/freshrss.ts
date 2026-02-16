import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";

export function createFreshrssApp(chart: Chart) {
  return new Application(chart, "freshrss-app", {
    metadata: {
      name: "freshrss",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~1.0.0-0",
        chart: "freshrss",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "freshrss",
      },
      syncPolicy: {
        automated: {},
      },
    },
  });
}
