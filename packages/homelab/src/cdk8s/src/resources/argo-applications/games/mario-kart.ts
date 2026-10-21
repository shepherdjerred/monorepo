import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { applicationProject } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/projects.ts";

export function createMarioKartApp(chart: Chart) {
  return new Application(chart, "mario-kart-app", {
    metadata: {
      name: "mario-kart",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: applicationProject("mario-kart"),
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "mario-kart",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "mario-kart",
      },
      syncPolicy: { automated: { enabled: true } },
    },
  });
}
