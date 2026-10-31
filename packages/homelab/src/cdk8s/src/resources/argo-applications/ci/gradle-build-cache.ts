import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { applicationProject } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/projects.ts";

export function createGradleBuildCacheApp(chart: Chart) {
  return new Application(chart, "gradle-build-cache-app", {
    metadata: {
      name: "gradle-build-cache",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: applicationProject("gradle-build-cache"),
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "gradle-build-cache",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "gradle-build-cache",
      },
      syncPolicy: {
        automated: { enabled: true },
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
