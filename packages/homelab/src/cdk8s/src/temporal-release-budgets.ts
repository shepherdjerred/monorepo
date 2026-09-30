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
 * Minimum Argo sync wait budget for the temporal child in `release-root`. The
 * waiter must outlast the migration hook it waits for: with the default 300 s
 * child budget, builds 16963 and 16977 failed the temporal sync while the
 * v1.14 migration was still legitimately running, and each retry replaced the
 * in-flight hook mid-DDL. 900 s of hook deadline plus 300 s for the wave-0
 * rollout and Argo apply latency.
 */
export const TEMPORAL_CHILD_SYNC_TIMEOUT_SECONDS = 1200;
