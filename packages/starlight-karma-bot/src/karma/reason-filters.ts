/** The import preserves legacy balances as synthetic ledger rows. They count
 * toward received totals, but they are not a person's explanation for giving
 * karma and must stay out of reason-oriented surfaces. */
export const SYNTHETIC_LEGACY_REASON = "legacy karma";

/** Prisma-compatible predicate for a positive, human-authored reason.
 *
 * Reaction awards intentionally have no reason. The source-message guard also
 * keeps rows written by older releases out of human reason feeds.
 */
export function humanReasonFilter() {
  return {
    amount: { gt: 0 },
    sourceMessageId: null,
    reason: { not: null },
    NOT: { reason: SYNTHETIC_LEGACY_REASON },
  };
}
