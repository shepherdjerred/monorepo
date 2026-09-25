import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { createWoodpeckerPostgreSQLDatabase } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/woodpecker-db.ts";
import { createWoodpeckerServer } from "@shepherdjerred/homelab/cdk8s/src/resources/woodpecker/index.ts";
import { createWoodpeckerAgent } from "@shepherdjerred/homelab/cdk8s/src/resources/woodpecker/agent.ts";
import { createWoodpeckerCaches } from "@shepherdjerred/homelab/cdk8s/src/resources/woodpecker/caches.ts";
import { createWoodpeckerMaintenanceWorker } from "@shepherdjerred/homelab/cdk8s/src/resources/woodpecker/maintenance-worker.ts";
import { createWoodpeckerConfigExtension } from "@shepherdjerred/homelab/cdk8s/src/resources/woodpecker/config-extension-workload.ts";
import { createWoodpeckerStepNetworkPolicy } from "@shepherdjerred/homelab/cdk8s/src/resources/woodpecker/step-network-policy.ts";
import { createWoodpeckerCiNamespace } from "@shepherdjerred/homelab/cdk8s/src/resources/woodpecker/ci-namespace.ts";
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
        // Unchanged from when step pods ran here. They now run in
        // `woodpecker-ci`; this namespace holds the control plane.
        "pod-security.kubernetes.io/enforce": "privileged",
        "pod-security.kubernetes.io/audit": "privileged",
        "pod-security.kubernetes.io/warn": "privileged",
      },
    },
  });

  createWoodpeckerCiNamespace(chart);
  createWoodpeckerCredentialBoundaries(chart);
  createWoodpeckerPostgreSQLDatabase(chart);
  createWoodpeckerServer(chart);
  createWoodpeckerAgent(chart);
  createWoodpeckerConfigExtension(chart);
  createWoodpeckerStepNetworkPolicy(chart);
  createWoodpeckerCaches(chart);
  createWoodpeckerMaintenanceWorker(chart);
}
