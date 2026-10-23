import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { applicationProject } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/projects.ts";

export function createMediaApp(chart: Chart) {
  return new Application(chart, "media-app", {
    metadata: {
      name: "media",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: applicationProject("media"),
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "media",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "media",
      },
      syncPolicy: {
        automated: { enabled: true },
        syncOptions: ["ServerSideApply=true"],
      },
    },
  });
}
