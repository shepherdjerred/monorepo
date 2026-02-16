import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";

export function createSyncthingApp(chart: Chart) {
  return new Application(chart, "syncthing-app", {
    metadata: {
      name: "syncthing",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~1.0.0-0",
        chart: "syncthing",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "syncthing",
      },
      syncPolicy: {
        automated: {},
      },
    },
  });
}
