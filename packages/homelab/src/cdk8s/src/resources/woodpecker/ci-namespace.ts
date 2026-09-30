import type { Chart } from "cdk8s";
import { Namespace } from "cdk8s-plus-31";
import {
  KubeLimitRange,
  KubeServiceAccount,
  Quantity,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { WOODPECKER_CI_NAMESPACE } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/ci/woodpecker-credentials.ts";

/** Opts a namespace into Kueue's admission (see `platform/kueue.ts`). */
export const KUEUE_MANAGED_NAMESPACE_LABEL = "kueue.x-k8s.io/managed-namespace";

/**
 * The namespace CI work runs in, and what keeps it from
 * repeating the July 2026 freezes, where unbounded CI took down the
 * production node.
 *
 * - **Kueue admission.** The managed label hands every pod created here to
 *   Kueue, which holds it behind a scheduling gate until the CI quota has
 *   room. The quota and queues live in `resources/kueue-config.ts`.
 * - **A default budget.** Woodpecker gives the clone pod no resources, and a
 *   pod without requests is invisible to both Kueue and the scheduler. The
 *   LimitRange gives it one; steps and services declare their own.
 * - **A fail-closed guard.** Placement, priority, and requests each come from
 *   a different layer -- agent defaults, the emitter, this LimitRange.
 *   `ci-pod-guard.ts` rejects a pod that arrives without them, so a
 *   regression in any layer is a failed step rather than CI on the
 *   production node.
 */
export function createWoodpeckerCiNamespace(chart: Chart): void {
  new Namespace(chart, "woodpecker-ci-namespace", {
    metadata: {
      name: WOODPECKER_CI_NAMESPACE,
      labels: {
        // CI step pods build container images and run privileged toolchains.
        // Restricted enforcement would reject them at admission.
        "pod-security.kubernetes.io/enforce": "privileged",
        "pod-security.kubernetes.io/audit": "privileged",
        "pod-security.kubernetes.io/warn": "privileged",
        [KUEUE_MANAGED_NAMESPACE_LABEL]: "true",
      },
    },
  });

  // The clone pod names no service account, so it runs as `default`. Like
  // `woodpecker-job`, it gets no token: nothing in a CI pod needs the API.
  new KubeServiceAccount(chart, "woodpecker-ci-default-sa", {
    metadata: { name: "default", namespace: WOODPECKER_CI_NAMESPACE },
    automountServiceAccountToken: false,
  });

  // Sized for the clone pod, the only CI pod without declared resources. A
  // shallow checkout writes to the workspace claim, not to ephemeral storage.
  new KubeLimitRange(chart, "woodpecker-ci-limit-range", {
    metadata: {
      name: "woodpecker-ci-default-resources",
      namespace: WOODPECKER_CI_NAMESPACE,
    },
    spec: {
      limits: [
        {
          type: "Container",
          defaultRequest: {
            cpu: Quantity.fromString("250m"),
            memory: Quantity.fromString("512Mi"),
            "ephemeral-storage": Quantity.fromString("1Gi"),
          },
          default: {
            cpu: Quantity.fromString("2"),
            memory: Quantity.fromString("2Gi"),
            "ephemeral-storage": Quantity.fromString("10Gi"),
          },
        },
      ],
    },
  });
}
