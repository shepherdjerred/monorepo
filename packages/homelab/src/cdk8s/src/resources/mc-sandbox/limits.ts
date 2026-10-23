import type { Chart } from "cdk8s";
import {
  KubeLimitRange,
  KubeResourceQuota,
  Quantity,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { LocalQueueV1Beta2 } from "@shepherdjerred/homelab/cdk8s/generated/imports/kueue.x-k8s.io.ts";
import { MC_SANDBOX_NAMESPACE } from "@shepherdjerred/homelab/cdk8s/src/resources/mc-sandbox/constants.ts";
import { CI_CLUSTER_QUEUE } from "@shepherdjerred/homelab/cdk8s/src/resources/kueue-config.ts";
import { transitionRendering } from "@shepherdjerred/homelab/cdk8s/src/release-configuration.ts";

/**
 * Hard cap on everything the harness can run at once. Sandboxes run on the CI
 * node (liskov) next to Woodpecker, whose admission budget Kueue enforces in
 * `resources/kueue-config.ts` (24 CPU / 72Gi of liskov's ~29 CPU / 91.5Gi).
 * The requests below fit in the remaining headroom, and the pods run at
 * `batch-low`, so service work can preempt them.
 *
 * Quantities are written in the API server's canonical form ("4", not
 * "4000m") so ArgoCD never sees a permanent diff (see kueue-config.ts).
 */
export const MC_SANDBOX_QUOTA = {
  pods: "3",
  "requests.cpu": "4",
  "requests.memory": "10Gi",
  "limits.memory": "14Gi",
  "requests.ephemeral-storage": "20Gi",
  "limits.ephemeral-storage": "40Gi",
} as const;

/**
 * Under transition rendering the namespace joins Kueue's `woodpecker`
 * ClusterQueue, which bounds the CI node, and its own quota grows by one
 * `test:e2e` qualification run (model E7 and V5) beside the interactive
 * sandboxes above: the candidate server pod the harness creates
 * (mc-harness `pod-manifest.ts`: Paper at 1 CPU, 3584Mi/4608Mi memory and
 * 2Gi/8Gi ephemeral storage, plus its 50m staging container) and the suite's
 * runner pod (2 CPU, 4Gi/6Gi memory, 4Gi/16Gi ephemeral storage), rounded up.
 */
export const MC_SANDBOX_QUALIFICATION_QUOTA = {
  pods: "5",
  "requests.cpu": "8",
  "requests.memory": "18Gi",
  "limits.memory": "26Gi",
  "requests.ephemeral-storage": "28Gi",
  "limits.ephemeral-storage": "66Gi",
} as const;

/** Kueue gives every pod in a managed namespace the LocalQueue named `default`. */
export const MC_SANDBOX_LOCAL_QUEUE = "default";

export function createMcSandboxLimits(
  chart: Chart,
  transition: boolean = transitionRendering(),
): void {
  // Defaults for a container that declares nothing; the harness sizes its
  // Paper containers explicitly, within the per-container maximum.
  new KubeLimitRange(chart, "mc-sandbox-limit-range", {
    metadata: {
      name: "mc-sandbox-default-resources",
      namespace: MC_SANDBOX_NAMESPACE,
    },
    spec: {
      limits: [
        {
          type: "Container",
          defaultRequest: {
            cpu: Quantity.fromString("250m"),
            memory: Quantity.fromString("256Mi"),
            "ephemeral-storage": Quantity.fromString("256Mi"),
          },
          default: {
            cpu: Quantity.fromString("1"),
            memory: Quantity.fromString("512Mi"),
            "ephemeral-storage": Quantity.fromString("1Gi"),
          },
          max: {
            memory: Quantity.fromString("6Gi"),
            "ephemeral-storage": Quantity.fromString("16Gi"),
          },
        },
      ],
    },
  });

  new KubeResourceQuota(chart, "mc-sandbox-quota", {
    metadata: { name: "mc-sandbox-quota", namespace: MC_SANDBOX_NAMESPACE },
    spec: {
      hard: Object.fromEntries(
        Object.entries(
          transition ? MC_SANDBOX_QUALIFICATION_QUOTA : MC_SANDBOX_QUOTA,
        ).map(([key, value]) => [key, Quantity.fromString(value)]),
      ),
    },
  });

  if (transition) {
    new LocalQueueV1Beta2(chart, "mc-sandbox-local-queue", {
      metadata: {
        name: MC_SANDBOX_LOCAL_QUEUE,
        namespace: MC_SANDBOX_NAMESPACE,
      },
      spec: { clusterQueue: CI_CLUSTER_QUEUE },
    });
  }
}
