import type { Db } from "#src/database/index.ts";

export function pendingDareV2CalloutRefresh() {
  return {
    calloutRefreshPending: true,
    calloutRefreshVersion: { increment: 1 },
  };
}

/**
 * Retire the pending callout of a Dare a silent match just resolved.
 *
 * Inside the settling transaction, and the placement is the whole point. The
 * pending flag is durable WORK: `refreshPendingDareV2Callouts` selects EVERY
 * globally pending Dare, and the v1 post-match and pre-match pollers run it
 * with no delivery mode at all, so a flag left set is a callout posted later
 * by a caller that was never told to keep it quiet.
 *
 * It was first retired from inside that scan, which was wrong in the other
 * direction: the scan's `mayPost` is one match's decision applied to a global
 * set, so a backfill retired the pending callouts of unrelated LIVE Dares —
 * permanently suppressing callouts that were owed, even when the backfill
 * resolved no Dare at all. A match-scoped decision may only touch the rows
 * that match resolved, and here that is exactly one row.
 *
 * Committing with the settlement is the other half: a retirement that failed
 * on its own would leave the flag set after the cursor moved, and the next
 * scanner would publish what this settlement decided to withhold.
 *
 * `messageRef: null` is the one guard kept: a Dare that already HAS a public
 * callout is owed its edit, and suppressing that would leave a stale message
 * rather than withhold a new one.
 */
export async function withholdDareV2Callout(
  tx: Db,
  dareId: number,
): Promise<void> {
  await tx.bucksDareV2.updateMany({
    where: { id: dareId, calloutRefreshPending: true, messageRef: null },
    data: { calloutRefreshPending: false },
  });
}
