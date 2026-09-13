import { syncBucksAnalytics } from "#src/analytics/bryan-bucks-sync.ts";

export type BryanBucksAnalyticsSyncOutcome = {
  status: "reconciled";
  detail: string;
};

/**
 * Reconcile the committed Bryan Bucks ledger into PostHog and report the
 * counts, for the internal control endpoint the Temporal analytics Schedule
 * drives.
 *
 * Bryan Bucks owns this operation; `analytics/` only holds its implementation.
 * Keeping the entry point here is what lets the HTTP adapter reach it without
 * taking a direct dependency on the analytics layer.
 */
export async function runBryanBucksAnalyticsSync(): Promise<BryanBucksAnalyticsSyncOutcome> {
  const result = await syncBucksAnalytics();
  return {
    status: "reconciled",
    detail: `ledger_entries=${result.ledgerEntries.toString()},snapshots=${result.snapshots.toString()}`,
  };
}
