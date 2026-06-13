import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";

export function createPinchtabApp(chart: Chart) {
  return new Application(chart, "pinchtab-app", {
    metadata: {
      name: "pinchtab",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "pinchtab",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "pinchtab",
      },
      syncPolicy: {
        automated: {},
      },
    },
  });
}
