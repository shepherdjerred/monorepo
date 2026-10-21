import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { applicationProject } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/projects.ts";

/**
 * Operator-run owner of Delivery's Namespace and PostgreSQL cluster. It is
 * released through the guarded `release-root` procedure, never by an
 * automated Delivery deployment of the `delivery` application chart.
 */
export function createDeliveryDataApp(chart: Chart) {
  return new Application(chart, "delivery-data-app", {
    metadata: {
      name: "delivery-data",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: applicationProject("delivery-data"),
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "delivery-data",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "delivery",
      },
      syncPolicy: {
        automated: { enabled: true },
      },
    },
  });
}
