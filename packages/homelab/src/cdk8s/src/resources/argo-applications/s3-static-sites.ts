import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";

export function createS3StaticSitesApp(chart: Chart) {
  return new Application(chart, "s3-static-sites-app", {
    metadata: {
      name: "s3-static-sites",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~1.0.0-0",
        chart: "s3-static-sites",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "s3-static-sites",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
