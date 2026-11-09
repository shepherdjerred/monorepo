/**
 * Kueue admission contract for Delivery stage Jobs. Temporal renders it into
 * every Job (`packages/temporal/src/lib/delivery/job-manifest.ts`) and cdk8s
 * sizes Delivery's ClusterQueue from it (`src/cdk8s/src/resources/kueue-config.ts`).
 */

/** The LocalQueue every new stage Job names in both Delivery Job namespaces. */
export const DELIVERY_STAGE_LOCAL_QUEUE = "delivery";

/**
 * The CI-shared LocalQueue that stage Jobs named before Delivery had its own
 * ClusterQueue. A LocalQueue's ClusterQueue is immutable, so the old queue
 * stays until no running Delivery worker can create or adopt such a Job.
 */
export const LEGACY_DELIVERY_STAGE_LOCAL_QUEUE = "default";

/**
 * Requests of a stage Job's only container. Delivery's ClusterQueue reserves
 * exactly one Job's worth, so changing these resizes that reservation.
 * Quantities use the form the API server stores, because ArgoCD diffs it.
 *
 * The workspace lives on a persistent claim (below), so the container's own
 * ephemeral storage holds only its logs: its root filesystem is read-only.
 */
export const DELIVERY_STAGE_REQUESTS = {
  cpu: "2",
  memory: "8Gi",
  "ephemeral-storage": "1Gi",
} as const;

/**
 * Persistent stage workspaces, one claim per install profile and Job
 * namespace, on liskov's ZFS pool instead of an emptyDir on its OS disk.
 *
 * A Job reuses the previous Job's checkout and `node_modules`: it fetches its
 * revision, checks it out by force, removes everything untracked except
 * `node_modules`, and `bun install --frozen-lockfile` then writes only what
 * the lockfile changed. The two install profiles never share a claim, because
 * alternating a production subset with a full install would rewrite the
 * difference every time. Bun copies rather than hardlinks from its cache, so a
 * shared cache alone would only have moved the writes.
 */
export const DELIVERY_STAGE_WORKSPACE_CLAIMS = {
  /** Every workspace's dependencies, generated code and the toolkit binary. */
  full: { claim: "delivery-stage-workspace-full", size: "40Gi" },
  /** Image provenance: the Temporal workspace's production closure only. */
  production: { claim: "delivery-stage-workspace-production", size: "20Gi" },
} as const;
export type DeliveryStageWorkspaceProfile =
  keyof typeof DELIVERY_STAGE_WORKSPACE_CLAIMS;

/** Profiles whose claim each Job namespace carries; platform recipes all install fully. */
export const DELIVERY_STAGE_WORKSPACE_PROFILES_BY_NAMESPACE = {
  "delivery-worker-jobs": ["full", "production"],
  "delivery-platform-jobs": ["full"],
} as const satisfies Record<string, readonly DeliveryStageWorkspaceProfile[]>;
