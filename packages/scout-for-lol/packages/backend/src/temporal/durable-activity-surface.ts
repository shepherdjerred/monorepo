import type { ScoutPipelineActivities } from "@scout-for-lol/temporal/activities";

/**
 * The durable lane's three activity groups, as TYPES and nothing else.
 *
 * A sibling of `match-activity-surface.ts` and here for exactly the same
 * reason, which is the import graph rather than tidiness. `connected-runtime.ts`
 * needs these shapes to describe the realtime, background and lake worker
 * groups, and `connected-runtime.ts` is reachable from the tRPC router — which
 * the browser apps import for `AppRouter`. When a group's type lived beside its
 * factory, asking for the type dragged the factory in, and a factory's
 * `await import(...)` calls are type edges even though they are not runtime
 * edges: the report renderer, the Discord client, the Riot client, Prisma and
 * the betting and progression slices behind them all entered
 * `@scout-for-lol/app`'s and `@scout-for-lol/activity`'s type programs.
 *
 * That is not merely wasteful. Backend sources are typechecked under the
 * backend's own tsconfig, whose `src/reset.d.ts` loads
 * `@total-typescript/ts-reset`; a browser app's tsconfig includes only its own
 * `src/**`, so the reset is absent and backend code relying on it stops
 * compiling — which is precisely how a `.filter(Boolean)` narrowing in the Dare
 * lifecycle broke `@scout-for-lol/activity` when these three types were first
 * declared beside their factories. Keeping the types here keeps each factory
 * reachable only from `activities.ts` and `realtime-activities.ts`, which no
 * other package's program includes.
 *
 * Three groups rather than one because the queue each Activity runs on is what
 * separates them, and that assignment is declared once in
 * `SCOUT_PIPELINE_ACTIVITY_QUEUE_CLASSES`. The notification lane deliberately spans
 * two of these: its short domain commits and its Discord send are realtime,
 * where latency is the product, while its render is background, where a slow
 * Satori pass cannot sit in front of a live match.
 */

export type ScoutNotificationActivities = Pick<
  ScoutPipelineActivities,
  | "readNotificationIntent"
  | "markNotificationReady"
  | "beginNotificationSend"
  | "deliverNotification"
  | "recordNotificationOutcome"
  | "afterNotificationDelivered"
>;

export type ScoutBackgroundActivities = Pick<
  ScoutPipelineActivities,
  | "renderNotificationArtifact"
  | "readRecoveryBatch"
  | "scanRecoveryPage"
  | "processRecoveryPage"
  | "digestRecoveryBatch"
  | "closeRecoveryBatch"
  | "scanPipelineReconciliationPage"
  | "backfillSilentPostmatchArtifact"
>;

export type ScoutLakeActivities = Pick<
  ScoutPipelineActivities,
  "stageLakeProjection"
>;
