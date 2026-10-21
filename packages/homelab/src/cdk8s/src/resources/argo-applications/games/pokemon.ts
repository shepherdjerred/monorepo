import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { applicationProject } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/projects.ts";

export function createPokemonApp(chart: Chart) {
  return new Application(chart, "pokemon-app", {
    metadata: {
      name: "pokemon",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: applicationProject("pokemon"),
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "pokemon",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "pokemon",
      },
      syncPolicy: { automated: { enabled: true } },
    },
  });
}
