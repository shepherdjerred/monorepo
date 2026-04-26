import { describe, expect, test } from "bun:test";
import { MonarchTransactionSchema } from "./types.ts";

describe("MonarchTransactionSchema", () => {
  test("accepts transactions without createdAt and updatedAt", () => {
    const transaction = MonarchTransactionSchema.parse({
      id: "txn-1",
      amount: -12.34,
      pending: false,
      date: "2026-04-25",
      hideFromReports: false,
      plaidName: "APPLE.COM/BILL",
      notes: null,
      isRecurring: false,
      reviewStatus: null,
      needsReview: false,
      isSplitTransaction: false,
      category: { id: "cat-1", name: "Shopping" },
      merchant: { id: "merchant-1", name: "Apple", transactionsCount: 3 },
      account: { id: "account-1", displayName: "Credit Card" },
      tags: [],
    });

    expect(transaction.createdAt).toBeUndefined();
    expect(transaction.updatedAt).toBeUndefined();
    expect(transaction.notes).toBe("");
    expect(transaction.reviewStatus).toBe("");
  });
});
