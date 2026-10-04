import type { Chart } from "cdk8s";
import {
  KubeLimitRange,
  KubeResourceQuota,
  Quantity,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { MC_SANDBOX_NAMESPACE } from "@shepherdjerred/homelab/cdk8s/src/resources/mc-sandbox/constants.ts";

/**
 * Hard cap on everything the harness can run at once. Sandboxes run on the CI
 * node (liskov) next to Woodpecker, whose admission budget Kueue enforces in
 * `resources/kueue-config.ts` (24 CPU / 80Gi of liskov's ~29 CPU / 91.5Gi).
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

export function createMcSandboxLimits(chart: Chart): void {
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
        Object.entries(MC_SANDBOX_QUOTA).map(([key, value]) => [
          key,
          Quantity.fromString(value),
        ]),
      ),
    },
  });
}
