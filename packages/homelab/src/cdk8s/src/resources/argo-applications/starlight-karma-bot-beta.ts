import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";

export function createStarlightKarmaBotBetaApp(chart: Chart) {
  return new Application(chart, "starlight-karma-bot-beta-app", {
    metadata: {
      name: "starlight-karma-bot-beta",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~1.0.0-0",
        chart: "starlight-karma-bot-beta",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "starlight-karma-bot-beta",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
