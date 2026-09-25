import { describe, expect, test } from "vitest";
import { sampleByMerchant } from "./sampling.ts";
import type { MonarchTransaction } from "./monarch/types.ts";

function makeTxn(
  id: string,
  merchantName: string,
  overrides: Partial<MonarchTransaction> = {},
): MonarchTransaction {
  return {
    id,
    amount: -10,
    pending: false,
    date: "2025-01-15",
    hideFromReports: false,
    plaidName: merchantName,
    notes: "",
    isRecurring: false,
    reviewStatus: "none",
    needsReview: false,
    isSplitTransaction: false,
    createdAt: "2025-01-15",
    updatedAt: "2025-01-15",
    category: { id: "cat-1", name: "Shopping" },
    merchant: {
      id: `m-${merchantName}`,
      name: merchantName,
      transactionsCount: 1,
    },
    account: { id: "a-1", displayName: "Checking" },
    tags: [],
    ...overrides,
  };
}

describe("sampleByMerchant", () => {
  test("keeps every transaction from the first N distinct merchants", () => {
    const transactions = [
      makeTxn("1", "Amazon"),
      makeTxn("2", "Costco"),
      makeTxn("3", "Amazon"),
      makeTxn("4", "Venmo"),
      makeTxn("5", "Costco"),
    ];

    const sampled = sampleByMerchant(transactions, 2);

    expect(sampled.map((t) => t.id)).toEqual(["1", "2", "3", "5"]);
  });

  test("returns everything when the sample size covers all merchants", () => {
    const transactions = [makeTxn("1", "Amazon"), makeTxn("2", "Costco")];

    const sampled = sampleByMerchant(transactions, 10);

    expect(sampled).toHaveLength(2);
  });

  test("returns nothing for a zero-size sample", () => {
    const transactions = [makeTxn("1", "Amazon")];

    expect(sampleByMerchant(transactions, 0)).toEqual([]);
  });

  test("handles an empty transaction list", () => {
    expect(sampleByMerchant([], 5)).toEqual([]);
  });
});
