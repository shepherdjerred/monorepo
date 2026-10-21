import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { applicationProject } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/projects.ts";

export function createGickupApp(chart: Chart) {
  return new Application(chart, "gickup-app", {
    metadata: {
      name: "gickup",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: applicationProject("gickup"),
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "gickup",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "gickup",
      },
      syncPolicy: {
        automated: { enabled: true },
      },
    },
  });
}
