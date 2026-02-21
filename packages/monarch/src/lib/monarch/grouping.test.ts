import { describe, expect, test } from "bun:test";
import { groupByMerchant } from "./client.ts";
import type { MonarchTransaction } from "./types.ts";

function makeTxn(
  overrides: Partial<MonarchTransaction> = {},
): MonarchTransaction {
  return {
    id: "txn-1",
    amount: -50,
    pending: false,
    date: "2025-01-15",
    hideFromReports: false,
    plaidName: "SOME STORE",
    notes: "",
    isRecurring: false,
    reviewStatus: "none",
    needsReview: false,
    isSplitTransaction: false,
    createdAt: "2025-01-15",
    updatedAt: "2025-01-15",
    category: { id: "cat-1", name: "Shopping" },
    merchant: { id: "m-1", name: "Some Store", transactionsCount: 5 },
    account: { id: "a-1", displayName: "Checking" },
    tags: [],
    ...overrides,
  };
}

describe("groupByMerchant", () => {
  test("groups transactions by merchant name", () => {
    const txns = [
      makeTxn({
        id: "t1",
        merchant: { id: "m-1", name: "Target", transactionsCount: 3 },
      }),
      makeTxn({
        id: "t2",
        merchant: { id: "m-2", name: "Costco", transactionsCount: 2 },
      }),
      makeTxn({
        id: "t3",
        merchant: { id: "m-1", name: "Target", transactionsCount: 3 },
      }),
    ];

    const { merchantGroups } = groupByMerchant(txns);
    const targetGroup = merchantGroups.find(
      (g) => g.merchantName === "Target",
    );
    const costcoGroup = merchantGroups.find(
      (g) => g.merchantName === "Costco",
    );

    expect(targetGroup?.count).toBe(2);
    expect(costcoGroup?.count).toBe(1);
  });

  test("computes total amounts", () => {
    const txns = [
      makeTxn({
        id: "t1",
        amount: -25,
        merchant: { id: "m-1", name: "Store", transactionsCount: 1 },
      }),
      makeTxn({
        id: "t2",
        amount: -75,
        merchant: { id: "m-1", name: "Store", transactionsCount: 1 },
      }),
    ];

    const { merchantGroups } = groupByMerchant(txns);
    expect(merchantGroups[0]?.totalAmount).toBe(100);
  });

  test("collects unique plaidNames", () => {
    const txns = [
      makeTxn({
        id: "t1",
        plaidName: "STORE #123",
        merchant: { id: "m-1", name: "Store", transactionsCount: 1 },
      }),
      makeTxn({
        id: "t2",
        plaidName: "STORE #456",
        merchant: { id: "m-1", name: "Store", transactionsCount: 1 },
      }),
      makeTxn({
        id: "t3",
        plaidName: "STORE #123",
        merchant: { id: "m-1", name: "Store", transactionsCount: 1 },
      }),
    ];

    const { merchantGroups } = groupByMerchant(txns);
    expect(merchantGroups[0]?.plaidNames).toEqual([
      "STORE #123",
      "STORE #456",
    ]);
  });

  test("separates Amazon transactions", () => {
    const txns = [
      makeTxn({
        id: "t1",
        merchant: { id: "m-1", name: "Amazon", transactionsCount: 5 },
      }),
      makeTxn({
        id: "t2",
        merchant: {
          id: "m-2",
          name: "AMZN MKTP US",
          transactionsCount: 3,
        },
      }),
      makeTxn({
        id: "t3",
        merchant: { id: "m-3", name: "Target", transactionsCount: 2 },
      }),
    ];

    const { amazonTransactions, merchantGroups } = groupByMerchant(txns);
    expect(amazonTransactions).toHaveLength(2);
    expect(merchantGroups).toHaveLength(1);
    expect(merchantGroups[0]?.merchantName).toBe("Target");
  });
});
