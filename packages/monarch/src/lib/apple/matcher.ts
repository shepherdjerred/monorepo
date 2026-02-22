import type { AppleReceipt } from "./types.ts";
import type { MonarchTransaction } from "../monarch/types.ts";

export type AppleMatch = {
  transaction: MonarchTransaction;
  receipt: AppleReceipt;
};

export type AppleMatchResult = {
  matched: AppleMatch[];
  unmatchedTransactions: MonarchTransaction[];
  unmatchedReceipts: AppleReceipt[];
};

export function matchAppleTransactions(
  monarchTxns: MonarchTransaction[],
  receipts: AppleReceipt[],
): AppleMatchResult {
  const matched: AppleMatch[] = [];
  const usedReceiptIds = new Set<string>();
  const matchedTransactionIds = new Set<string>();

  const eligible = monarchTxns.filter((t) => !t.isSplitTransaction);

  for (const transaction of eligible) {
    const txnAmount = Math.abs(transaction.amount);
    const txnDate = new Date(transaction.date);

    for (const receipt of receipts) {
      if (usedReceiptIds.has(receipt.orderId)) continue;

      const receiptDate = new Date(receipt.date);
      const daysDiff =
        Math.abs(txnDate.getTime() - receiptDate.getTime()) /
        (1000 * 60 * 60 * 24);

      if (daysDiff > 3) continue;
      if (Math.abs(txnAmount - receipt.total) > 0.01) continue;

      matched.push({ transaction, receipt });
      usedReceiptIds.add(receipt.orderId);
      matchedTransactionIds.add(transaction.id);
      break;
    }
  }

  const unmatchedTransactions = eligible.filter(
    (t) => !matchedTransactionIds.has(t.id),
  );
  const unmatchedReceipts = receipts.filter(
    (r) => !usedReceiptIds.has(r.orderId),
  );

  return { matched, unmatchedTransactions, unmatchedReceipts };
}
