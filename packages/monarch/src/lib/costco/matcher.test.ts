import { describe, expect, test } from "bun:test";
import { matchCostcoTransactions } from "./matcher.ts";
import type { MonarchTransaction } from "../monarch/types.ts";
import type { CostcoOrder } from "./types.ts";

function makeTxn(overrides: Partial<MonarchTransaction> = {}): MonarchTransaction {
  return {
    id: "txn-1",
    amount: -150,
    pending: false,
    date: "2025-01-15",
    hideFromReports: false,
    plaidName: "COSTCO WHSE",
    notes: "",
    isRecurring: false,
    reviewStatus: "none",
    needsReview: false,
    isSplitTransaction: false,
    createdAt: "2025-01-15",
    updatedAt: "2025-01-15",
    category: { id: "cat-1", name: "Shopping" },
    merchant: { id: "m-1", name: "Costco", transactionsCount: 5 },
    account: { id: "a-1", displayName: "Checking" },
    tags: [],
    ...overrides,
  };
}

function makeOrder(overrides: Partial<CostcoOrder> = {}): CostcoOrder {
  return {
    orderId: "costco-001",
    date: "2025-01-15",
    total: 150,
    items: [{ title: "Kirkland Paper Towels", price: 22.99, quantity: 1 }],
    source: "warehouse",
    ...overrides,
  };
}

describe("matchCostcoTransactions", () => {
  test("matches by date and amount", () => {
    const result = matchCostcoTransactions([makeTxn()], [makeOrder()]);
    expect(result.matched).toHaveLength(1);
    expect(result.unmatchedTransactions).toHaveLength(0);
  });

  test("matches within 5-day window", () => {
    const txns = [makeTxn({ date: "2025-01-19" })];
    const orders = [makeOrder({ date: "2025-01-15" })];

    const result = matchCostcoTransactions(txns, orders);
    expect(result.matched).toHaveLength(1);
  });

  test("does not match beyond 5-day window", () => {
    const txns = [makeTxn({ date: "2025-01-25" })];
    const orders = [makeOrder({ date: "2025-01-15" })];

    const result = matchCostcoTransactions(txns, orders);
    expect(result.matched).toHaveLength(0);
  });

  test("matches with amount tolerance up to $1", () => {
    const txns = [makeTxn({ amount: -150.75 })];
    const orders = [makeOrder({ total: 150 })];

    const result = matchCostcoTransactions(txns, orders);
    expect(result.matched).toHaveLength(1);
  });

  test("does not match with amount difference over $1", () => {
    const txns = [makeTxn({ amount: -155 })];
    const orders = [makeOrder({ total: 150 })];

    const result = matchCostcoTransactions(txns, orders);
    expect(result.matched).toHaveLength(0);
  });

  test("skips split transactions", () => {
    const txns = [makeTxn({ isSplitTransaction: true })];
    const orders = [makeOrder()];

    const result = matchCostcoTransactions(txns, orders);
    expect(result.matched).toHaveLength(0);
  });
});
