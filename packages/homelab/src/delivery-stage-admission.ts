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
 */
export const DELIVERY_STAGE_REQUESTS = {
  cpu: "2",
  memory: "8Gi",
  "ephemeral-storage": "32Gi",
} as const;
