import { describe, expect, test } from "bun:test";
import { matchAppleTransactions } from "./matcher.ts";
import type { MonarchTransaction } from "../monarch/types.ts";
import type { AppleReceipt } from "./types.ts";

function makeTxn(overrides: Partial<MonarchTransaction> = {}): MonarchTransaction {
  return {
    id: "txn-1",
    amount: -14.32,
    pending: false,
    date: "2022-03-04",
    hideFromReports: false,
    plaidName: "APPLE.COM/BILL",
    notes: "",
    isRecurring: false,
    reviewStatus: "none",
    needsReview: false,
    isSplitTransaction: false,
    createdAt: "2022-03-04",
    updatedAt: "2022-03-04",
    category: { id: "cat-1", name: "Shopping" },
    merchant: { id: "m-1", name: "Apple Services", transactionsCount: 5 },
    account: { id: "a-1", displayName: "Checking" },
    tags: [],
    ...overrides,
  };
}

function makeReceipt(overrides: Partial<AppleReceipt> = {}): AppleReceipt {
  return {
    orderId: "MSSN309W58",
    date: "2022-03-04",
    total: 14.32,
    items: [{ title: "Headspace", price: 12.99, isSubscription: true }],
    ...overrides,
  };
}

describe("matchAppleTransactions", () => {
  test("matches by date and amount", () => {
    const txns = [makeTxn()];
    const receipts = [makeReceipt()];

    const result = matchAppleTransactions(txns, receipts);
    expect(result.matched).toHaveLength(1);
    expect(result.unmatchedTransactions).toHaveLength(0);
    expect(result.unmatchedReceipts).toHaveLength(0);
  });

  test("matches within 3-day window", () => {
    const txns = [makeTxn({ date: "2022-03-06" })];
    const receipts = [makeReceipt({ date: "2022-03-04" })];

    const result = matchAppleTransactions(txns, receipts);
    expect(result.matched).toHaveLength(1);
  });

  test("does not match beyond 3-day window", () => {
    const txns = [makeTxn({ date: "2022-03-10" })];
    const receipts = [makeReceipt({ date: "2022-03-04" })];

    const result = matchAppleTransactions(txns, receipts);
    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedTransactions).toHaveLength(1);
    expect(result.unmatchedReceipts).toHaveLength(1);
  });

  test("does not match different amounts", () => {
    const txns = [makeTxn({ amount: -20 })];
    const receipts = [makeReceipt({ total: 14.32 })];

    const result = matchAppleTransactions(txns, receipts);
    expect(result.matched).toHaveLength(0);
  });

  test("skips split transactions", () => {
    const txns = [makeTxn({ isSplitTransaction: true })];
    const receipts = [makeReceipt()];

    const result = matchAppleTransactions(txns, receipts);
    expect(result.matched).toHaveLength(0);
  });
});
