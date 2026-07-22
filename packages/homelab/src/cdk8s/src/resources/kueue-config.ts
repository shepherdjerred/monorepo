import type { Chart } from "cdk8s";
import { ApiObject } from "cdk8s";
import { BUILDKITE_MAX_IN_FLIGHT } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/buildkite.ts";

/**
 * Creates Kueue resource management configuration for the Buildkite namespace.
 *
 * Caps the buildkite namespace at 12 CPU / 20Gi of requests. Sized to measured
 * headroom on 2026-07-22: non-buildkite namespaces commit only 13.2 CPU / 45Gi
 * of the node's 27 CPU / 73Gi allocatable, leaving ~13.8 CPU / 28Gi schedulable
 * for CI. 12 CPU / 20Gi stays comfortably inside that with margin against the
 * 8Gi soft-eviction floor (the freeze incidents earned that caution). Combined
 * with the right-sized per-step requests in .buildkite/pipeline.yml (a heavy
 * privileged pod costs ~1.75 CPU / 3.5Gi, vs 3 CPU / 8Gi before), this admits
 * ~6 concurrent heavy pods instead of 2 — the fix for the admission starvation
 * that made CI p50 22m / p90 124m in the two weeks before this change (see
 * packages/docs/logs/2026-07-22_ci-capacity-analysis.md). Raising further is a
 * one-line bump once the freeze canaries (node MemAvailable, ZfsArcHitRateLow,
 * eviction events) stay quiet under the new load.
 *
 * Jobs exceeding the quota are suspended (not rejected), eliminating
 * FailedCreate event storms.
 *
 * The `pods` covered resource is capped at `BUILDKITE_MAX_IN_FLIGHT`.
 * Buildkite's `max-in-flight` is the real, primary concurrency control (see the
 * long comment on it in buildkite.ts); this is a cheap, independent second
 * enforcement point at the K8s admission layer in case that setting ever
 * regresses (e.g. a future Helm-values typo). Kueue admission accounting is
 * always requests-based, so the CPU/memory nominal quota is scoped against the
 * per-step requests regardless of the pods cap.
 */
export function createKueueConfig(chart: Chart) {
  new ApiObject(chart, "kueue-resource-flavor", {
    apiVersion: "kueue.x-k8s.io/v1beta1",
    kind: "ResourceFlavor",
    metadata: {
      name: "default",
    },
  });

  new ApiObject(chart, "kueue-cluster-queue", {
    apiVersion: "kueue.x-k8s.io/v1beta1",
    kind: "ClusterQueue",
    metadata: {
      name: "buildkite",
    },
    spec: {
      namespaceSelector: {
        matchLabels: {
          "kueue.x-k8s.io/managed-namespace": "true",
        },
      },
      preemption: {
        withinClusterQueue: "Never",
        reclaimWithinCohort: "Never",
      },
      resourceGroups: [
        {
          coveredResources: ["cpu", "memory", "pods"],
          flavors: [
            {
              name: "default",
              resources: [
                {
                  name: "cpu",
                  nominalQuota: "12000m",
                },
                {
                  name: "memory",
                  nominalQuota: "20Gi",
                },
                {
                  name: "pods",
                  nominalQuota: String(BUILDKITE_MAX_IN_FLIGHT),
                },
              ],
            },
          ],
        },
      ],
    },
  });

  new ApiObject(chart, "kueue-local-queue", {
    apiVersion: "kueue.x-k8s.io/v1beta1",
    kind: "LocalQueue",
    metadata: {
      name: "default",
      namespace: "buildkite",
    },
    spec: {
      clusterQueue: "buildkite",
    },
  });
}
