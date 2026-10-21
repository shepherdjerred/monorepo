import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { applicationProject } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/projects.ts";

export function createFliptApp(chart: Chart) {
  return new Application(chart, "flipt-app", {
    metadata: {
      name: "flipt",
      annotations: { "argocd.argoproj.io/sync-wave": "-2" },
    },
    spec: {
      revisionHistoryLimit: 5,
      project: applicationProject("flipt"),
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "flipt",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "flipt",
      },
      syncPolicy: {
        automated: { enabled: true },
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
