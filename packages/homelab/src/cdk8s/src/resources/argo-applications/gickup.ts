import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";

export function createGickupApp(chart: Chart) {
  return new Application(chart, "gickup-app", {
    metadata: {
      name: "gickup",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~1.0.0-0",
        chart: "gickup",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "gickup",
      },
      syncPolicy: {
        automated: {},
      },
    },
  });
}
