import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";

export function createPlausibleApp(chart: Chart) {
  return new Application(chart, "plausible-app", {
    metadata: {
      name: "plausible",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~1.0.0-0",
        chart: "plausible",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "plausible",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
