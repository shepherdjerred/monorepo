import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { applicationProject } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/projects.ts";

export function createBirmelApp(chart: Chart) {
  return new Application(chart, "birmel-app", {
    metadata: {
      name: "birmel",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: applicationProject("birmel"),
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "birmel",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "birmel",
      },
      syncPolicy: {
        automated: { enabled: true },
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
