import type { VenmoTransaction } from "./types.ts";
import type { MonarchTransaction } from "../monarch/types.ts";

export type VenmoMatch = {
  transaction: MonarchTransaction;
  venmoTransaction: VenmoTransaction;
};

export type VenmoMatchResult = {
  matched: VenmoMatch[];
  unmatchedTransactions: MonarchTransaction[];
  unmatchedVenmo: VenmoTransaction[];
};

export function matchVenmoTransactions(
  monarchTxns: MonarchTransaction[],
  venmoTxns: VenmoTransaction[],
): VenmoMatchResult {
  const matched: VenmoMatch[] = [];
  const usedVenmoIds = new Set<string>();
  const matchedTransactionIds = new Set<string>();

  const eligible = monarchTxns.filter((t) => !t.isSplitTransaction);

  for (const transaction of eligible) {
    const txnAmount = transaction.amount;
    const txnDate = new Date(transaction.date);

    for (const venmo of venmoTxns) {
      if (usedVenmoIds.has(venmo.id)) continue;

      // Compare date portions only — Venmo datetimes have time-of-day
      // that causes timezone mismatches with Monarch's date-only strings
      const venmoDateStr = venmo.datetime.split("T")[0] ?? "";
      const venmoDate = new Date(venmoDateStr);
      const daysDiff =
        Math.abs(txnDate.getTime() - venmoDate.getTime()) /
        (1000 * 60 * 60 * 24);

      if (daysDiff > 2) continue;

      if (Math.abs(txnAmount - venmo.amount) > 0.02) continue;

      matched.push({
        transaction,
        venmoTransaction: venmo,
      });
      usedVenmoIds.add(venmo.id);
      matchedTransactionIds.add(transaction.id);
      break;
    }
  }

  const unmatchedTransactions = eligible.filter(
    (t) => !matchedTransactionIds.has(t.id),
  );
  const unmatchedVenmo = venmoTxns.filter((v) => !usedVenmoIds.has(v.id));

  return { matched, unmatchedTransactions, unmatchedVenmo };
}
