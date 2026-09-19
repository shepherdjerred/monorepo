import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { createWoodpeckerPostgreSQLDatabase } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/woodpecker-db.ts";
import { createWoodpeckerServer } from "@shepherdjerred/homelab/cdk8s/src/resources/woodpecker/index.ts";
import { createWoodpeckerAgent } from "@shepherdjerred/homelab/cdk8s/src/resources/woodpecker/agent.ts";
import {
  createWoodpeckerCredentialBoundaries,
  WOODPECKER_NAMESPACE,
} from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/woodpecker-credentials.ts";

export function createWoodpeckerChart(app: App) {
  const chart = new Chart(app, "woodpecker", {
    namespace: WOODPECKER_NAMESPACE,
    disableResourceNameHashes: true,
  });

  new Namespace(chart, "woodpecker-namespace", {
    metadata: {
      name: WOODPECKER_NAMESPACE,
      labels: {
        // CI step pods build container images and run privileged toolchains,
        // exactly as the Buildkite namespace did. Restricted enforcement would
        // reject them at admission.
        "pod-security.kubernetes.io/enforce": "privileged",
        "pod-security.kubernetes.io/audit": "privileged",
        "pod-security.kubernetes.io/warn": "privileged",
      },
    },
  });

  createWoodpeckerCredentialBoundaries(chart);
  createWoodpeckerPostgreSQLDatabase(chart);
  createWoodpeckerServer(chart);
  createWoodpeckerAgent(chart);
}
