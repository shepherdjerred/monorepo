import { describe, expect, test } from "vitest";
import { matchAppleTransactions } from "./matcher.ts";
import type { MonarchTransaction } from "../monarch/types.ts";
import type { AppleReceipt } from "./types.ts";

function makeTxn(
  overrides: Partial<MonarchTransaction> = {},
): MonarchTransaction {
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

  test("matches within 7-day window", () => {
    const txns = [makeTxn({ date: "2022-03-10" })];
    const receipts = [makeReceipt({ date: "2022-03-04" })];

    const result = matchAppleTransactions(txns, receipts);
    expect(result.matched).toHaveLength(1);
  });

  test("does not match beyond 7-day window", () => {
    const txns = [makeTxn({ date: "2022-03-15" })];
    const receipts = [makeReceipt({ date: "2022-03-04" })];

    const result = matchAppleTransactions(txns, receipts);
    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedTransactions).toHaveLength(1);
    expect(result.unmatchedReceipts).toHaveLength(1);
  });

  test("skips receipts with unparseable dates instead of matching blindly", () => {
    const txns = [makeTxn({ date: "2022-03-04" })];
    const receipts = [makeReceipt({ date: "" })];

    const result = matchAppleTransactions(txns, receipts);
    expect(result.matched).toHaveLength(0);
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

describe("matchAppleTransactions — recurring charges of equal price", () => {
  // Measured against the live mail store: the first-found rule attached eight
  // $33.09 Apple One charges to the previous week's receipt, and two to a
  // receipt issued days after the charge.
  test("takes the nearest receipt, not the first one in the list", () => {
    const txns = [
      makeTxn({ id: "t-mar-19", date: "2025-03-19", amount: -33.09 }),
      makeTxn({ id: "t-mar-26", date: "2025-03-26", amount: -33.09 }),
    ];
    const receipts = [
      makeReceipt({ orderId: "r-mar-19", date: "2025-03-19", total: 33.09 }),
      makeReceipt({ orderId: "r-mar-26", date: "2025-03-26", total: 33.09 }),
    ];

    const result = matchAppleTransactions(txns, receipts);

    expect(
      result.matched.map((m) => [m.transaction.id, m.receipt.orderId]),
    ).toEqual([
      ["t-mar-19", "r-mar-19"],
      ["t-mar-26", "r-mar-26"],
    ]);
  });

  test("never attaches a receipt issued after the charge posted", () => {
    const txns = [makeTxn({ date: "2025-03-19", amount: -33.09 })];
    const receipts = [
      makeReceipt({ orderId: "r-later", date: "2025-03-26", total: 33.09 }),
    ];

    expect(matchAppleTransactions(txns, receipts).matched).toEqual([]);
  });
});
