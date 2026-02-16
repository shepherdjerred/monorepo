import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";

export function createBetterSkillCappedFetcherApp(chart: Chart) {
  return new Application(chart, "better-skill-capped-fetcher-app", {
    metadata: {
      name: "better-skill-capped-fetcher",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~1.0.0-0",
        chart: "better-skill-capped-fetcher",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "better-skill-capped",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
