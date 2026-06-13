import type { Chart } from "cdk8s";
import { ApiObject } from "cdk8s";

/**
 * Creates Kueue resource management configuration for the Buildkite namespace.
 *
 * Caps the buildkite namespace at 7.5 CPU / 16Gi of requests (node is 32c/128Gi, but CPU requests
 * from other namespaces leave only ~2.5 cores of schedulable headroom — raising this further just
 * converts Kueue-suspended jobs into unschedulable Pending pods).
 * Jobs exceeding the quota are suspended (not rejected), eliminating FailedCreate event storms.
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
          coveredResources: ["cpu", "memory"],
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
