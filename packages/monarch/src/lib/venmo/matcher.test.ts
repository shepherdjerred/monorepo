import { describe, expect, test } from "bun:test";
import { matchVenmoTransactions } from "./matcher.ts";
import type { MonarchTransaction } from "../monarch/types.ts";
import type { VenmoTransaction } from "./types.ts";

function makeTxn(
  overrides: Partial<MonarchTransaction> = {},
): MonarchTransaction {
  return {
    id: "txn-1",
    amount: -25.75,
    pending: false,
    date: "2025-03-03",
    hideFromReports: false,
    plaidName: "VENMO",
    notes: "",
    isRecurring: false,
    reviewStatus: "none",
    needsReview: false,
    isSplitTransaction: false,
    createdAt: "2025-03-03",
    updatedAt: "2025-03-03",
    category: { id: "cat-1", name: "Uncategorized" },
    merchant: { id: "m-1", name: "Venmo", transactionsCount: 5 },
    account: { id: "a-1", displayName: "Venmo Balance" },
    tags: [],
    ...overrides,
  };
}

function makeVenmo(
  overrides: Partial<VenmoTransaction> = {},
): VenmoTransaction {
  return {
    id: "v-1",
    datetime: "2025-03-03T02:39:32",
    type: "Payment",
    status: "Complete",
    note: "La dive",
    from: "Jerred Shepherd",
    to: "Nikita Zolotykh",
    amount: -25.75,
    tip: 0,
    tax: 0,
    fee: 0.75,
    ...overrides,
  };
}

describe("matchVenmoTransactions", () => {
  test("exact date and amount match", () => {
    const txns = [makeTxn()];
    const venmo = [makeVenmo()];
    const result = matchVenmoTransactions(txns, venmo);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]?.transaction.id).toBe("txn-1");
    expect(result.matched[0]?.venmoTransaction.id).toBe("v-1");
    expect(result.unmatchedTransactions).toHaveLength(0);
    expect(result.unmatchedVenmo).toHaveLength(0);
  });

  test("matches within 2-day window", () => {
    const txns = [makeTxn({ date: "2025-03-05" })];
    const venmo = [makeVenmo({ datetime: "2025-03-03T02:39:32" })];
    const result = matchVenmoTransactions(txns, venmo);

    expect(result.matched).toHaveLength(1);
  });

  test("does not match outside 2-day window", () => {
    const txns = [makeTxn({ date: "2025-03-06" })];
    const venmo = [makeVenmo({ datetime: "2025-03-03T02:39:32" })];
    const result = matchVenmoTransactions(txns, venmo);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedTransactions).toHaveLength(1);
    expect(result.unmatchedVenmo).toHaveLength(1);
  });

  test("matches within $0.02 amount tolerance", () => {
    const txns = [makeTxn({ amount: -25.76 })];
    const venmo = [makeVenmo({ amount: -25.75 })];
    const result = matchVenmoTransactions(txns, venmo);

    expect(result.matched).toHaveLength(1);
  });

  test("does not match beyond $0.02 tolerance", () => {
    const txns = [makeTxn({ amount: -30 })];
    const venmo = [makeVenmo({ amount: -25.75 })];
    const result = matchVenmoTransactions(txns, venmo);

    expect(result.matched).toHaveLength(0);
  });

  test("skips split transactions", () => {
    const txns = [makeTxn({ isSplitTransaction: true })];
    const venmo = [makeVenmo()];
    const result = matchVenmoTransactions(txns, venmo);

    expect(result.matched).toHaveLength(0);
  });

  test("skips Transfer category transactions", () => {
    const txns = [makeTxn({ category: { id: "cat-2", name: "Transfer" } })];
    const venmo = [makeVenmo()];
    const result = matchVenmoTransactions(txns, venmo);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedVenmo).toHaveLength(1);
  });

  test("matches Venmo Balance side when both bank-side and Venmo-side exist", () => {
    const txns = [
      makeTxn({
        id: "txn-bank",
        category: { id: "cat-2", name: "Transfer" },
        account: { id: "a-2", displayName: "Checking" },
      }),
      makeTxn({
        id: "txn-venmo",
        category: { id: "cat-1", name: "Uncategorized" },
        account: { id: "a-1", displayName: "Venmo Balance" },
      }),
    ];
    const venmo = [makeVenmo()];
    const result = matchVenmoTransactions(txns, venmo);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]?.transaction.id).toBe("txn-venmo");
  });

  test("does not duplicate matches", () => {
    const txns = [
      makeTxn({ id: "txn-1", amount: -25.75 }),
      makeTxn({ id: "txn-2", amount: -25.75 }),
    ];
    const venmo = [makeVenmo({ id: "v-1", amount: -25.75 })];
    const result = matchVenmoTransactions(txns, venmo);

    expect(result.matched).toHaveLength(1);
    expect(result.unmatchedTransactions).toHaveLength(1);
    expect(result.unmatchedVenmo).toHaveLength(0);
  });

  test("no match when nothing matches", () => {
    const txns = [makeTxn({ amount: -100 })];
    const venmo = [makeVenmo({ amount: -25.75 })];
    const result = matchVenmoTransactions(txns, venmo);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedTransactions).toHaveLength(1);
    expect(result.unmatchedVenmo).toHaveLength(1);
  });

  test("matches positive amounts (received payments)", () => {
    const txns = [makeTxn({ amount: 100 })];
    const venmo = [makeVenmo({ amount: 100, datetime: "2025-03-03T17:53:50" })];
    const result = matchVenmoTransactions(txns, venmo);

    expect(result.matched).toHaveLength(1);
  });
});
