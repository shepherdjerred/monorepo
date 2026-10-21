import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { applicationProject } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/projects.ts";

/**
 * Operator-run owner of Temporal's Namespace, PostgreSQL TLS chain, cluster
 * and database NetworkPolicy. It is released through the guarded
 * `release-root` procedure, never by an automated Temporal deployment of the
 * `temporal` application chart.
 */
export function createTemporalDataApp(chart: Chart) {
  return new Application(chart, "temporal-data-app", {
    metadata: {
      name: "temporal-data",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: applicationProject("temporal-data"),
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "temporal-data",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "temporal",
      },
      syncPolicy: {
        automated: { enabled: true },
      },
    },
  });
}
