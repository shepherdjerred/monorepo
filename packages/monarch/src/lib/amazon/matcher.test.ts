import { describe, expect, test } from "bun:test";
import { matchAmazonOrders } from "./matcher.ts";
import type { MonarchTransaction } from "../monarch/types.ts";
import type { AmazonOrder } from "./types.ts";

function makeTxn(
  overrides: Partial<MonarchTransaction> = {},
): MonarchTransaction {
  return {
    id: "txn-1",
    amount: -29.99,
    pending: false,
    date: "2025-01-15",
    hideFromReports: false,
    plaidName: "AMZN MKTP US",
    notes: "",
    isRecurring: false,
    reviewStatus: "none",
    needsReview: false,
    isSplitTransaction: false,
    createdAt: "2025-01-15",
    updatedAt: "2025-01-15",
    category: { id: "cat-1", name: "Shopping" },
    merchant: { id: "m-1", name: "Amazon", transactionsCount: 10 },
    account: { id: "a-1", displayName: "Checking" },
    tags: [],
    ...overrides,
  };
}

function makeOrder(overrides: Partial<AmazonOrder> = {}): AmazonOrder {
  return {
    orderId: "order-1",
    date: "2025-01-15",
    total: 29.99,
    items: [
      {
        title: "USB-C Cable",
        price: 29.99,
        quantity: 1,
        orderDate: "2025-01-15",
        orderId: "order-1",
      },
    ],
    ...overrides,
  };
}

describe("matchAmazonOrders", () => {
  test("exact date and amount match", () => {
    const txns = [makeTxn()];
    const orders = [makeOrder()];
    const result = matchAmazonOrders(txns, orders);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]?.transaction.id).toBe("txn-1");
    expect(result.matched[0]?.order.orderId).toBe("order-1");
    expect(result.unmatchedTransactions).toHaveLength(0);
    expect(result.unmatchedOrders).toHaveLength(0);
  });

  test("matches within 3-day window", () => {
    const txns = [makeTxn({ date: "2025-01-18" })];
    const orders = [makeOrder({ date: "2025-01-15" })];
    const result = matchAmazonOrders(txns, orders);

    expect(result.matched).toHaveLength(1);
  });

  test("does not match outside 3-day window", () => {
    const txns = [makeTxn({ date: "2025-01-20" })];
    const orders = [makeOrder({ date: "2025-01-15" })];
    const result = matchAmazonOrders(txns, orders);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedTransactions).toHaveLength(1);
  });

  test("matches within $0.02 rounding tolerance", () => {
    const txns = [makeTxn({ amount: -30 })];
    const orders = [makeOrder({ total: 29.99 })];
    const result = matchAmazonOrders(txns, orders);

    expect(result.matched).toHaveLength(1);
  });

  test("does not match beyond $0.02 tolerance", () => {
    const txns = [makeTxn({ amount: -35 })];
    const orders = [makeOrder({ total: 29.99 })];
    const result = matchAmazonOrders(txns, orders);

    expect(result.matched).toHaveLength(0);
  });

  test("skips already-split transactions", () => {
    const txns = [makeTxn({ isSplitTransaction: true })];
    const orders = [makeOrder()];
    const result = matchAmazonOrders(txns, orders);

    expect(result.matched).toHaveLength(0);
  });

  test("matches single-item order by item price", () => {
    const txns = [makeTxn({ amount: -25 })];
    const orders = [
      makeOrder({
        total: 27.5,
        items: [
          {
            title: "Widget",
            price: 25,
            quantity: 1,
            orderDate: "2025-01-15",
            orderId: "order-1",
          },
        ],
      }),
    ];
    const result = matchAmazonOrders(txns, orders);

    expect(result.matched).toHaveLength(1);
  });

  test("no match when nothing matches", () => {
    const txns = [makeTxn({ amount: -100 })];
    const orders = [makeOrder({ total: 29.99 })];
    const result = matchAmazonOrders(txns, orders);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedTransactions).toHaveLength(1);
    expect(result.unmatchedOrders).toHaveLength(1);
  });
});
