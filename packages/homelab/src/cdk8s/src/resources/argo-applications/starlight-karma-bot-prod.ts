import type { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";

export function createStarlightKarmaBotProdApp(chart: Chart) {
  return new Application(chart, "starlight-karma-bot-prod-app", {
    metadata: {
      name: "starlight-karma-bot-prod",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~1.0.0-0",
        chart: "starlight-karma-bot-prod",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "starlight-karma-bot-prod",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
