import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";

export function createGlitterBoysLauncherApp(chart: Chart) {
  return new Application(chart, "glitter-boys-launcher-app", {
    metadata: {
      name: "glitter-boys-launcher",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "glitter-boys-launcher",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "glitter-boys-launcher",
      },
      syncPolicy: {
        automated: { enabled: true },
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
