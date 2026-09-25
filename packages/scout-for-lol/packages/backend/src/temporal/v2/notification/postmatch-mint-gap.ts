import { prisma, type Db } from "#src/database/index.ts";
import { countUnmintedLivePostmatchMatches } from "#src/database/durable/pipeline-gaps.ts";
import { createLogger } from "#src/logger.ts";
import { scoutDurablePostmatchMintGaps } from "#src/metrics/durable-pipeline.ts";
import { registerDatabaseMetricSweep } from "#src/metrics/sweep-registry.ts";
import { scoutV2NotificationRenderReceiptKind } from "#src/temporal/v2/notification-receipts.ts";

const logger = createLogger("postmatch-mint-gap");

/**
 * How far back a finished match can still be counted as owed a report.
 *
 * Six hours: long enough that a gap stays firing through the alert's `for` and
 * an operator's first look, short enough that a historical gap stops paging on
 * its own once it has been handled — whether by the silent backfill's render
 * receipts (see below) or by a decision to leave it. It also caps the scan to a
 * range over six hours of observations.
 */
export const POSTMATCH_MINT_GAP_LOOKBACK_MS = 6 * 60 * 60 * 1000;

/**
 * How long after its last cursor advance a match must have been finished.
 *
 * The mint runs before the cursors move, so a finished match has already
 * passed it; this only keeps a scrape from counting a match whose Activity is
 * committing as the read runs.
 */
export const POSTMATCH_MINT_GAP_GRACE_MS = 15 * 60 * 1000;

/**
 * The zero-mint signal: finished live V2 matches with no report instruction.
 *
 * The outage this exists for ran the V2 core to completion for 28 hours
 * without minting a single postmatch intent. Nothing was stalled and nothing
 * failed, so every existing gauge was green: the notification scan drives
 * intents that exist, and none did. This counts the matches that should have
 * one — see `countUnmintedLivePostmatchMatches` for exactly which, and why
 * the count is an under-count by construction rather than a noisy one.
 *
 * ## Why this is not in `metrics/`
 *
 * The read excludes matches carrying the post-match render receipt, because
 * that is what the silent backfill writes when an operator remediates an
 * incident like this one. The receipt kind is the notification lane's, and
 * `metrics/` may not import `temporal/`, so the sweep lives with the
 * vocabulary and registers itself, as `report-lake/lake-staging-lag.ts` does.
 *
 * -1 on failure rather than a cleared series: `ScoutDurableSweepFailing`
 * watches for the sentinel, and a cleared series would instead fire this
 * gauge's own `absent()` guard with a message about the wrong cause.
 */
export async function collectPostmatchMintGapMetrics(db: Db): Promise<void> {
  const now = Date.now();
  try {
    scoutDurablePostmatchMintGaps.set(
      await countUnmintedLivePostmatchMatches(db, {
        renderReceiptKind: scoutV2NotificationRenderReceiptKind("postmatch"),
        observedSince: new Date(now - POSTMATCH_MINT_GAP_LOOKBACK_MS),
        settledBefore: new Date(now - POSTMATCH_MINT_GAP_GRACE_MS),
      }),
    );
  } catch (error) {
    scoutDurablePostmatchMintGaps.set(-1);
    logger.error("Failed to update the postmatch mint gap metric", { error });
  }
}

async function updatePostmatchMintGapMetrics(): Promise<void> {
  await collectPostmatchMintGapMetrics(prisma);
}

/** Add this sweep to the scrape-time set; called by the composition root. */
export function registerPostmatchMintGapSweep(): void {
  registerDatabaseMetricSweep(
    "postmatch-mint-gap",
    updatePostmatchMintGapMetrics,
  );
}
