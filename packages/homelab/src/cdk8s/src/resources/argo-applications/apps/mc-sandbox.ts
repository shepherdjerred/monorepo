import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { applicationProject } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/projects.ts";

export function createMcSandboxApp(chart: Chart) {
  return new Application(chart, "mc-sandbox-app", {
    metadata: { name: "mc-sandbox" },
    spec: {
      revisionHistoryLimit: 5,
      project: applicationProject("mc-sandbox"),
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "mc-sandbox",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "mc-sandbox",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
