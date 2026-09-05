import type { Chart } from "cdk8s";
import { ApiObject } from "cdk8s";
import { BUILDKITE_MAX_IN_FLIGHT } from "@shepherdjerred/homelab/cdk8s/src/misc/buildkite.ts";

/**
 * Creates Kueue resource management configuration for the Buildkite namespace.
 *
 * Caps the buildkite namespace at 24 CPU / 80Gi of requests. Sized to liskov's
 * current allocatable capacity of roughly 83.5Gi after Talos reservations and
 * eviction floors. Memory sits below the full allocatable capacity because the
 * CI workspace is memory-backed (agent-stack `workspace-volume` tmpfs — see
 * argo-applications/ci/buildkite.ts): checkout explicitly requests 1Gi and each
 * step request covers its own install/workspace demand. Image builds use the
 * remote BuildKit daemon and do not run DinD sidecars. The request-weighted
 * quota admits broad light-job mixes while keeping verify, Playwright, and
 * image-heavy mixes bounded by CPU and memory rather than the 24-pod count cap.
 * The 8Gi
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
      annotations: { "argocd.argoproj.io/sync-wave": "2" },
    },
  });

  new ApiObject(chart, "kueue-cluster-queue", {
    apiVersion: "kueue.x-k8s.io/v1beta1",
    kind: "ClusterQueue",
    metadata: {
      name: "buildkite",
      annotations: { "argocd.argoproj.io/sync-wave": "2" },
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
          // an ephemeral-storage request on every step container, and
          // Kueue refuses to admit a workload that requests a resource its
          // ClusterQueue does not cover ("resource ephemeral-storage unavailable
          // in ClusterQueue"). Omitting it froze CI completely — every workload
          // sat Pending and no build could run (which also blocked the
          // argocd-sync that would have shipped this very fix).
          coveredResources: ["cpu", "memory", "pods", "ephemeral-storage"],
          flavors: [
            {
              name: "default",
              resources: [
                {
                  name: "cpu",
                  // Canonical "24", NOT "24000m": Kueue/Kubernetes normalises
                  // the stored Quantity to "24", and ArgoCD diffs the raw string
                  // — "12000m" in the chart vs "12" live is a permanent phantom
                  // OutOfSync that wedges the app-of-apps sync (it never reaches
                  // Synced, so every argocd-sync CI step then fails). Keep this
                  // in the form the API server stores.
                  nominalQuota: "24",
                },
                {
                  name: "memory",
                  nominalQuota: "80Gi",
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
      annotations: { "argocd.argoproj.io/sync-wave": "2" },
    },
    spec: {
      clusterQueue: "buildkite",
    },
  });
}
