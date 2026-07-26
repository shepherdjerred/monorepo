import type { Chart } from "cdk8s";
import { ApiObject } from "cdk8s";
import { BUILDKITE_MAX_IN_FLIGHT } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/buildkite.ts";

/**
 * Creates Kueue resource management configuration for the Buildkite namespace.
 *
 * Caps the buildkite namespace at 12 CPU / 28Gi of requests. Sized to measured
 * headroom on 2026-07-22: non-buildkite namespaces commit only 13.2 CPU / 45Gi
 * of the node's 27 CPU / 73Gi allocatable, leaving ~13.8 CPU / 28Gi schedulable
 * for CI. Memory sits at the full 28Gi headroom because the CI workspace
 * volume is memory-backed now (agent-stack `workspace-volume` tmpfs — see
 * argo-applications/buildkite.ts): checkout explicitly requests 1Gi, while
 * per-step requests absorb install bytes as RAM (verify 6Gi + checkout 1Gi +
 * dind 1.5Gi; other privileged 2Gi + checkout 1Gi + dind 1.5Gi; light 512Mi +
 * checkout 1Gi), trading admission width for near-zero NVMe writes from those
 * pods. This still admits verify plus ~3-4 other heavy pods concurrently, vs
 * the pre-2026-07-22 starvation of 2 (see
 * packages/docs/logs/2026-07-22_ci-capacity-analysis.md). The 8Gi
 * soft-eviction floor stays armed (the freeze incidents earned that caution);
 * if the canaries (node MemAvailable, ZfsArcHitRateLow, eviction events) fire,
 * the quota and the workspace sizeLimit are one-line back-offs.
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
          // ephemeral-storage MUST be covered here: .buildkite/pipeline.yml sets
          // an ephemeral-storage *request* on every step/dind container, and
          // Kueue refuses to admit a workload that requests a resource its
          // ClusterQueue does not cover ("resource ephemeral-storage unavailable
          // in ClusterQueue"). Omitting it froze CI completely — every workload
          // sat Pending and no build could run (which also blocked the
          // argocd-sync that would have shipped this very fix). See
          // packages/docs/logs/2026-07-24_ci-main-kueue-ephemeral-storage-freeze.md.
          coveredResources: ["cpu", "memory", "pods", "ephemeral-storage"],
          flavors: [
            {
              name: "default",
              resources: [
                {
                  name: "cpu",
                  // Canonical "12", NOT "12000m": Kueue/Kubernetes normalises
                  // the stored Quantity to "12", and ArgoCD diffs the raw string
                  // — "12000m" in the chart vs "12" live is a permanent phantom
                  // OutOfSync that wedges the app-of-apps sync (it never reaches
                  // Synced, so every argocd-sync CI step then fails). Keep this
                  // in the form the API server stores.
                  nominalQuota: "12",
                },
                {
                  name: "memory",
                  nominalQuota: "28Gi",
                },
                {
                  name: "pods",
                  nominalQuota: String(BUILDKITE_MAX_IN_FLIGHT),
                },
                {
                  // Generous headroom, deliberately NOT a binding constraint:
                  // CPU/memory gate concurrency first (~6 heavy pods at 6Gi eph
                  // request each ≈ 36Gi). 100Gi leaves ~2x margin and sits far
                  // under the node's multi-TiB ephemeral capacity — it exists
                  // only so Kueue can account for the pods' eph requests.
                  name: "ephemeral-storage",
                  nominalQuota: "100Gi",
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
