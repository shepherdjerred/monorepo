import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { applicationProject } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/projects.ts";

export function createDeliveryApp(chart: Chart) {
  return new Application(chart, "delivery-app", {
    metadata: { name: "delivery" },
    spec: {
      project: applicationProject("delivery"),
      revisionHistoryLimit: 5,
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        chart: "delivery",
        targetRevision: "~2.0.0-0",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "delivery",
      },
      syncPolicy: {
        automated: { enabled: false },
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
