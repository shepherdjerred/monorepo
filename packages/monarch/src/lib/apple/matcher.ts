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

// Apple bills up to about a week after issuing the receipt, and never before
// it. A small negative delay is still allowed because the receipt carries a
// date and the bank a posting day, which can disagree by a day across time
// zones; beyond that a "later" receipt belongs to the next recurrence.
const MAX_POSTING_DELAY_DAYS = 7;
const MAX_RECEIPT_LEAD_DAYS = 1;
const DAY_MS = 1000 * 60 * 60 * 24;

// Signed days from the receipt to the bank posting; undefined when the pair
// cannot be a match at all. Unparseable receipt dates fail closed (NaN passes
// no comparison, which previously disabled the window entirely).
function postingDelayDays(
  receipt: AppleReceipt,
  txnDate: Date,
  txnAmount: number,
): number | undefined {
  if (receipt.date === "") return undefined;
  const receiptDate = new Date(receipt.date);
  if (Number.isNaN(receiptDate.getTime())) return undefined;
  const delay = (txnDate.getTime() - receiptDate.getTime()) / DAY_MS;
  if (delay > MAX_POSTING_DELAY_DAYS) return undefined;
  if (delay < -MAX_RECEIPT_LEAD_DAYS) return undefined;
  return Math.abs(txnAmount - receipt.total) > 0.01 ? undefined : delay;
}

export function matchAppleTransactions(
  monarchTxns: MonarchTransaction[],
  receipts: AppleReceipt[],
): AppleMatchResult {
  const matched: AppleMatch[] = [];
  const usedReceiptIds = new Set<string>();
  const matchedTransactionIds = new Set<string>();

  // Oldest charge first, so the earliest of a run of equal-priced recurring
  // purchases claims the earliest receipt rather than whichever the receipt
  // list happened to hold first.
  const eligible = monarchTxns
    .filter((t) => !t.isSplitTransaction)
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const transaction of eligible) {
    const txnAmount = Math.abs(transaction.amount);
    const txnDate = new Date(transaction.date);

    // The closest receipt, not the first one in the list: a $4.99 monthly
    // subscription produces an identical receipt every month, and within a
    // seven-day window first-fit would attach the wrong month's items.
    let best: { receipt: AppleReceipt; delay: number } | undefined;
    for (const receipt of receipts) {
      if (usedReceiptIds.has(receipt.orderId)) continue;
      const delay = postingDelayDays(receipt, txnDate, txnAmount);
      if (delay === undefined) continue;
      if (best === undefined || Math.abs(delay) < Math.abs(best.delay)) {
        best = { receipt, delay };
      }
    }
    if (best === undefined) continue;

    matched.push({ transaction, receipt: best.receipt });
    usedReceiptIds.add(best.receipt.orderId);
    matchedTransactionIds.add(transaction.id);
  }

  const unmatchedTransactions = eligible.filter(
    (t) => !matchedTransactionIds.has(t.id),
  );
  const unmatchedReceipts = receipts.filter(
    (r) => !usedReceiptIds.has(r.orderId),
  );

  return { matched, unmatchedTransactions, unmatchedReceipts };
}
