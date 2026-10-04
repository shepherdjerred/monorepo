import type { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import { KubeServiceAccount } from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import {
  MC_HARNESS_SERVICE_ACCOUNT,
  MC_SANDBOX_NAMESPACE,
} from "@shepherdjerred/homelab/cdk8s/src/resources/mc-sandbox/constants.ts";

export function createMcSandboxNamespace(chart: Chart): void {
  new Namespace(chart, "mc-sandbox-namespace", {
    metadata: {
      name: MC_SANDBOX_NAMESPACE,
      labels: {
        // Paper runs as uid 1000 with no capabilities, so the strictest
        // profile fits (the Storm image passes it in its boot check).
        "pod-security.kubernetes.io/enforce": "restricted",
        "pod-security.kubernetes.io/audit": "restricted",
        "pod-security.kubernetes.io/warn": "restricted",
      },
    },
  });

  // The identity the operator's daemon impersonates
  // (`kubectl --as=system:serviceaccount:mc-sandbox:mc-harness`). Nothing runs
  // as it in-cluster, so it never gets a token.
  new KubeServiceAccount(chart, "mc-harness-sa", {
    metadata: {
      name: MC_HARNESS_SERVICE_ACCOUNT,
      namespace: MC_SANDBOX_NAMESPACE,
    },
    automountServiceAccountToken: false,
  });

  // Sandbox pods name no service account; they never need the API either.
  new KubeServiceAccount(chart, "mc-sandbox-default-sa", {
    metadata: { name: "default", namespace: MC_SANDBOX_NAMESPACE },
    automountServiceAccountToken: false,
  });
}
