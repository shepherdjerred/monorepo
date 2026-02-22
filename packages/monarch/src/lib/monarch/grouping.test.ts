import { describe, expect, test } from "bun:test";
import { separateDeepPaths, isVenmoP2P, isBiltTransaction, isAppleMerchant, isCostcoMerchant } from "./client.ts";
import { groupByWeek, buildWeekWindows, getISOWeekKey, getWeekBounds } from "./weeks.ts";
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

describe("separateDeepPaths", () => {
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

    const { amazonTransactions, regularTransactions } = separateDeepPaths(txns);
    expect(amazonTransactions).toHaveLength(2);
    expect(regularTransactions).toHaveLength(1);
    expect(regularTransactions[0]?.merchant.name).toBe("Target");
  });

  test("separates Venmo P2P transactions", () => {
    const txns = [
      makeTxn({
        id: "t1",
        merchant: { id: "m-1", name: "Venmo", transactionsCount: 5 },
        plaidName: "VENMO",
      }),
      makeTxn({
        id: "t2",
        merchant: { id: "m-2", name: "Venmo Credit Card Payment", transactionsCount: 1 },
        plaidName: "VENMO CREDIT CARD",
      }),
      makeTxn({
        id: "t3",
        merchant: { id: "m-3", name: "Target", transactionsCount: 2 },
      }),
    ];

    const { venmoTransactions, regularTransactions } = separateDeepPaths(txns);
    expect(venmoTransactions).toHaveLength(1);
    expect(venmoTransactions[0]?.id).toBe("t1");
    expect(regularTransactions.some((t) => t.merchant.name === "Venmo Credit Card Payment")).toBe(true);
  });

  test("separates Bilt transactions", () => {
    const txns = [
      makeTxn({
        id: "t1",
        merchant: { id: "m-1", name: "Bilt", transactionsCount: 12 },
        plaidName: "BILT",
      }),
      makeTxn({
        id: "t2",
        merchant: { id: "m-2", name: "Bilt Credit Card Cash Back", transactionsCount: 1 },
        plaidName: "BILT REWARDS",
      }),
      makeTxn({
        id: "t3",
        merchant: { id: "m-3", name: "Target", transactionsCount: 2 },
      }),
    ];

    const { biltTransactions, regularTransactions } = separateDeepPaths(txns);
    expect(biltTransactions).toHaveLength(1);
    expect(biltTransactions[0]?.id).toBe("t1");
    expect(regularTransactions.some((t) => t.merchant.name === "Bilt Credit Card Cash Back")).toBe(true);
  });

  test("puts regular transactions in regularTransactions", () => {
    const txns = [
      makeTxn({
        id: "t1",
        merchant: { id: "m-1", name: "Target", transactionsCount: 3 },
      }),
      makeTxn({
        id: "t2",
        merchant: { id: "m-2", name: "Walmart", transactionsCount: 2 },
      }),
    ];

    const { regularTransactions } = separateDeepPaths(txns);
    expect(regularTransactions).toHaveLength(2);
  });

  test("separates Apple transactions", () => {
    const txns = [
      makeTxn({
        id: "t1",
        merchant: { id: "m-1", name: "Apple Services", transactionsCount: 5 },
        plaidName: "APPLE.COM/BILL",
      }),
      makeTxn({
        id: "t2",
        merchant: { id: "m-2", name: "Target", transactionsCount: 2 },
      }),
    ];

    const { appleTransactions, regularTransactions } = separateDeepPaths(txns);
    expect(appleTransactions).toHaveLength(1);
    expect(appleTransactions[0]?.id).toBe("t1");
    expect(regularTransactions).toHaveLength(1);
  });

  test("separates Costco transactions", () => {
    const txns = [
      makeTxn({
        id: "t1",
        merchant: { id: "m-1", name: "Costco", transactionsCount: 5 },
        plaidName: "COSTCO WHSE",
      }),
      makeTxn({
        id: "t2",
        merchant: { id: "m-2", name: "COSTCO.COM", transactionsCount: 2 },
        plaidName: "COSTCO.COM",
      }),
      makeTxn({
        id: "t3",
        merchant: { id: "m-3", name: "Target", transactionsCount: 2 },
      }),
    ];

    const { costcoTransactions, regularTransactions } = separateDeepPaths(txns);
    expect(costcoTransactions).toHaveLength(2);
    expect(regularTransactions).toHaveLength(1);
  });
});

describe("isVenmoP2P", () => {
  test("identifies Venmo P2P", () => {
    expect(isVenmoP2P("Venmo", "VENMO")).toBe(true);
  });

  test("excludes Venmo Credit Card", () => {
    expect(isVenmoP2P("Venmo Credit Card Payment", "")).toBe(false);
  });

  test("excludes Venmo Cash Back", () => {
    expect(isVenmoP2P("Venmo Credit Card Cash Back", "")).toBe(false);
  });

  test("detects via plaidName", () => {
    expect(isVenmoP2P("Some Name", "VENMO PAYMENT")).toBe(true);
  });

  test("returns false for non-Venmo", () => {
    expect(isVenmoP2P("Target", "TARGET STORE")).toBe(false);
  });
});

describe("isBiltTransaction", () => {
  test("identifies Bilt", () => {
    expect(isBiltTransaction("Bilt", "BILT")).toBe(true);
  });

  test("excludes Bilt Credit Card Cash Back", () => {
    expect(isBiltTransaction("Bilt Credit Card Cash Back", "")).toBe(false);
  });

  test("detects via plaidName", () => {
    expect(isBiltTransaction("Some Name", "BILT PAYMENT")).toBe(true);
  });

  test("returns false for non-Bilt", () => {
    expect(isBiltTransaction("Target", "TARGET STORE")).toBe(false);
  });
});

describe("isAppleMerchant", () => {
  test("identifies Apple Services", () => {
    expect(isAppleMerchant("Apple Services", "")).toBe(true);
  });

  test("identifies via plaidName", () => {
    expect(isAppleMerchant("Some Name", "APPLE.COM/BILL")).toBe(true);
  });

  test("returns false for non-Apple", () => {
    expect(isAppleMerchant("Target", "TARGET STORE")).toBe(false);
  });
});

describe("isCostcoMerchant", () => {
  test("identifies Costco", () => {
    expect(isCostcoMerchant("Costco", "COSTCO")).toBe(true);
  });

  test("identifies COSTCO WHSE", () => {
    expect(isCostcoMerchant("COSTCO WHSE", "")).toBe(true);
  });

  test("identifies COSTCO.COM", () => {
    expect(isCostcoMerchant("", "COSTCO.COM")).toBe(true);
  });

  test("returns false for non-Costco", () => {
    expect(isCostcoMerchant("Target", "TARGET STORE")).toBe(false);
  });
});

describe("getISOWeekKey", () => {
  test("returns correct week key", () => {
    // 2026-02-17 is a Tuesday in week 8
    expect(getISOWeekKey("2026-02-17")).toBe("2026-W08");
  });

  test("handles week 1 of year", () => {
    // 2026-01-01 is a Thursday in week 1
    expect(getISOWeekKey("2026-01-01")).toBe("2026-W01");
  });

  test("handles year boundary", () => {
    // 2025-12-31 is a Wednesday — ISO week 1 of 2026
    expect(getISOWeekKey("2025-12-31")).toBe("2026-W01");
  });
});

describe("getWeekBounds", () => {
  test("returns Monday to Sunday", () => {
    const bounds = getWeekBounds("2026-W08");
    expect(bounds.start).toBe("2026-02-16");
    expect(bounds.end).toBe("2026-02-22");
  });

  test("week 1 bounds", () => {
    const bounds = getWeekBounds("2026-W01");
    expect(bounds.start).toBe("2025-12-29");
    expect(bounds.end).toBe("2026-01-04");
  });
});

describe("groupByWeek", () => {
  test("groups transactions by ISO week", () => {
    const txns = [
      makeTxn({ id: "t1", date: "2026-02-17" }),
      makeTxn({ id: "t2", date: "2026-02-18" }),
      makeTxn({ id: "t3", date: "2026-02-24" }),
    ];

    const weeks = groupByWeek(txns);
    expect(weeks).toHaveLength(2);
    expect(weeks[0]?.weekKey).toBe("2026-W08");
    expect(weeks[0]?.transactions).toHaveLength(2);
    expect(weeks[1]?.weekKey).toBe("2026-W09");
    expect(weeks[1]?.transactions).toHaveLength(1);
  });

  test("sorts transactions within weeks by date", () => {
    const txns = [
      makeTxn({ id: "t1", date: "2026-02-19" }),
      makeTxn({ id: "t2", date: "2026-02-17" }),
      makeTxn({ id: "t3", date: "2026-02-18" }),
    ];

    const weeks = groupByWeek(txns);
    const dates = weeks[0]?.transactions.map((t) => t.date);
    expect(dates).toEqual(["2026-02-17", "2026-02-18", "2026-02-19"]);
  });

  test("sorts weeks chronologically", () => {
    const txns = [
      makeTxn({ id: "t1", date: "2026-03-01" }),
      makeTxn({ id: "t2", date: "2026-02-01" }),
    ];

    const weeks = groupByWeek(txns);
    expect((weeks[0]?.weekKey ?? "") < (weeks[1]?.weekKey ?? "")).toBe(true);
  });
});

describe("buildWeekWindows", () => {
  test("creates sliding windows with previous/next", () => {
    const txns = [
      makeTxn({ id: "t1", date: "2026-02-10" }),
      makeTxn({ id: "t2", date: "2026-02-17" }),
      makeTxn({ id: "t3", date: "2026-02-24" }),
    ];

    const weeks = groupByWeek(txns);
    const windows = buildWeekWindows(weeks);

    expect(windows).toHaveLength(3);

    // First window: no previous
    expect(windows[0]?.previous).toBeUndefined();
    expect(windows[0]?.current.weekKey).toBe("2026-W07");
    expect(windows[0]?.next?.weekKey).toBe("2026-W08");

    // Middle window: has both
    expect(windows[1]?.previous?.weekKey).toBe("2026-W07");
    expect(windows[1]?.current.weekKey).toBe("2026-W08");
    expect(windows[1]?.next?.weekKey).toBe("2026-W09");

    // Last window: no next
    expect(windows[2]?.previous?.weekKey).toBe("2026-W08");
    expect(windows[2]?.current.weekKey).toBe("2026-W09");
    expect(windows[2]?.next).toBeUndefined();
  });

  test("single week has no previous or next", () => {
    const txns = [makeTxn({ id: "t1", date: "2026-02-17" })];
    const weeks = groupByWeek(txns);
    const windows = buildWeekWindows(weeks);

    expect(windows).toHaveLength(1);
    expect(windows[0]?.previous).toBeUndefined();
    expect(windows[0]?.next).toBeUndefined();
  });
});
