import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";

export function createBugsinkApp(chart: Chart) {
  return new Application(chart, "bugsink-app", {
    metadata: {
      name: "bugsink",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~1.0.0-0",
        chart: "bugsink",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "bugsink",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
