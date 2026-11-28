/**
 * Budgets coupling the temporal chart to the `release-root` waiter, shared by
 * both: the chart sizes its migration Job from the deadline, and `argocd.ts`
 * sizes the temporal sync wait from the floor. This module intentionally
 * imports nothing, so either runtime loads it without the cdk8s graph.
 */

/**
 * How long the temporal `schema-migration` Sync hook may run before Kubernetes
 * kills it. DDL on the visibility store rewrites `executions_visibility`
 * under a live server: the 1.31.2 migration (visibility v1.14, two `STORED`
 * generated columns on a 6 GiB table) needed most of this budget under
 * production write traffic. The chart's Job spec and the release wait floor
 * below both derive from this number; changing it means re-verifying both.
 */
export const TEMPORAL_SCHEMA_MIGRATION_ACTIVE_DEADLINE_SECONDS = 900;

/**
 * Minimum Argo sync wait budget for the temporal child in `release-root` and
 * Delivery's `temporal/prod` readback waiter. The waiter must outlast both:
 * - the 900 s `schema-migration` Sync hook (builds 16963 and 16977 timed out
 *   at 300 s while the v1.14 DDL migration was still running), and
 * - `temporal-temporal-promotion-worker`'s 1080 s `Recreate` pod drain
 *   (`PROMOTION_POD_TERMINATION_SECONDS`) plus its 1380 s
 *   `progressDeadlineSeconds` and rollout/Argo apply headroom.
 */
export const TEMPORAL_CHILD_SYNC_TIMEOUT_SECONDS = 1500;
