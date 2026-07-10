import type { Chart } from "cdk8s";
import { ApiObject } from "cdk8s";
import { BUILDKITE_MAX_IN_FLIGHT } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/buildkite.ts";

/**
 * Creates Kueue resource management configuration for the Buildkite namespace.
 *
 * Caps the buildkite namespace at 7.5 CPU / 16Gi of requests (node is 32c/128Gi, but CPU requests
 * from other namespaces leave only ~2.5 cores of schedulable headroom — raising this further just
 * converts Kueue-suspended jobs into unschedulable Pending pods).
 * Jobs exceeding the quota are suspended (not rejected), eliminating FailedCreate event storms.
 *
 * 2026-07 CI-freeze hardening: `pods` added as a covered resource, capped at
 * `BUILDKITE_MAX_IN_FLIGHT`. Buildkite's `max-in-flight` is the real, primary
 * concurrency control (see the long comment on it in buildkite.ts); this is a
 * cheap, independent second enforcement point at the K8s admission layer in
 * case that setting ever regresses (e.g. a future Helm-values typo). No
 * change to the CPU/memory nominal quota — Kueue admission accounting is
 * always requests-based, and 7.5 CPU / 16Gi remains correctly scoped against
 * the small per-step requests regardless of the pods cap.
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
                  nominalQuota: "7500m",
                },
                {
                  name: "memory",
                  nominalQuota: "16Gi",
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
