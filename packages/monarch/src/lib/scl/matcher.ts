import type { MonarchTransaction } from "../monarch/types.ts";
import type { SclBill } from "./types.ts";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export type SclMatch = {
  transaction: MonarchTransaction;
  bill: SclBill;
};

export type SclMatchResult = {
  matched: SclMatch[];
  unmatchedTransactions: MonarchTransaction[];
  unmatchedBills: SclBill[];
};

export function matchSclTransactions(
  monarchTxns: MonarchTransaction[],
  bills: SclBill[],
): SclMatchResult {
  const matched: SclMatch[] = [];
  const usedBillDates = new Set<string>();
  const matchedTxnIds = new Set<string>();

  const eligible = monarchTxns.filter((t) => !t.isSplitTransaction);

  for (const txn of eligible) {
    const txnAmount = Math.abs(txn.amount);
    const txnDate = new Date(txn.date);

    for (const bill of bills) {
      if (usedBillDates.has(bill.billDate)) continue;

      // Match against due date (when payment is typically made) with wider window
      const dueDate = new Date(bill.dueDate);
      const daysDiff = Math.abs(txnDate.getTime() - dueDate.getTime()) / MS_PER_DAY;

      if (daysDiff > 5) continue;
      if (Math.abs(txnAmount - bill.billAmount) > 0.02) continue;

      matched.push({ transaction: txn, bill });
      matchedTxnIds.add(txn.id);
      usedBillDates.add(bill.billDate);
      break;
    }
  }

  const unmatchedTransactions = eligible.filter((t) => !matchedTxnIds.has(t.id));
  const unmatchedBills = bills.filter((b) => !usedBillDates.has(b.billDate));
  return { matched, unmatchedTransactions, unmatchedBills };
}
