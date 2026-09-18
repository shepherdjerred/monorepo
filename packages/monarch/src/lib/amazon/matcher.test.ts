import { describe, expect, test } from "vitest";
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
    charges: [],
    ...overrides,
  };
}

function makeItem(title: string, price: number): AmazonOrder["items"][number] {
  return {
    title,
    price,
    quantity: 1,
    orderDate: "2025-01-15",
    orderId: "order-1",
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

describe("matchAmazonOrders charge matching", () => {
  test("multi-charge order is matched by two transactions", () => {
    const order = makeOrder({
      total: 300,
      items: [makeItem("A", 95), makeItem("B", 190)],
      charges: [
        { date: "2025-01-16", amount: 100, description: "Visa ending in 1" },
        { date: "2025-01-20", amount: 200, description: "Visa ending in 1" },
      ],
    });
    const txns = [
      makeTxn({ id: "t1", amount: -100, date: "2025-01-16" }),
      makeTxn({ id: "t2", amount: -200, date: "2025-01-21" }),
    ];
    const result = matchAmazonOrders(txns, [order]);

    expect(result.matched).toHaveLength(2);
    expect(result.matched.every((m) => m.matchType === "charge")).toBe(true);
    expect(result.unmatchedOrders).toHaveLength(0);
  });

  test("a charge is consumed at most once", () => {
    const order = makeOrder({
      charges: [{ date: "2025-01-15", amount: 29.99, description: "Visa" }],
    });
    const txns = [makeTxn({ id: "t1" }), makeTxn({ id: "t2" })];
    const result = matchAmazonOrders(txns, [order]);

    expect(result.matched).toHaveLength(1);
    expect(result.unmatchedTransactions).toHaveLength(1);
  });

  test("duplicate charge amounts pair by nearest date", () => {
    const order = makeOrder({
      total: 40,
      charges: [
        { date: "2025-01-15", amount: 20, description: "Visa" },
        { date: "2025-01-18", amount: 20, description: "Visa" },
      ],
    });
    const txns = [
      makeTxn({ id: "t-late", amount: -20, date: "2025-01-18" }),
      makeTxn({ id: "t-early", amount: -20, date: "2025-01-15" }),
    ];
    const result = matchAmazonOrders(txns, [order]);

    expect(result.matched).toHaveLength(2);
    const byTxn = new Map(result.matched.map((m) => [m.transaction.id, m]));
    expect(byTxn.get("t-early")).toBeDefined();
    expect(byTxn.get("t-late")).toBeDefined();
  });

  test("charge posted long after the order date still matches near the charge date", () => {
    const order = makeOrder({
      date: "2025-01-05",
      charges: [{ date: "2025-01-15", amount: 29.99, description: "Visa" }],
    });
    const txns = [makeTxn({ date: "2025-01-16" })];
    const result = matchAmazonOrders(txns, [order]);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]?.matchType).toBe("charge");
  });

  test("order with charges never falls back to order-total matching", () => {
    const order = makeOrder({
      total: 29.99,
      charges: [{ date: "2025-06-01", amount: 29.99, description: "Visa" }],
    });
    // Transaction near the order date but far from the charge date
    const txns = [makeTxn({ date: "2025-01-15" })];
    const result = matchAmazonOrders(txns, [order]);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedTransactions).toHaveLength(1);
  });

  test("attaches the unambiguous item subset for a partial-shipment charge", () => {
    const order = makeOrder({
      total: 274.99,
      items: [makeItem("BOOX Tablet", 199.99), makeItem("Case", 50)],
      charges: [{ date: "2025-01-15", amount: 213.77, description: "Visa" }],
    });
    const txns = [makeTxn({ amount: -213.77 })];
    const result = matchAmazonOrders(txns, [order]);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]?.items.map((i) => i.title)).toEqual([
      "BOOX Tablet",
    ]);
  });

  test("attaches the full item list when the subset is ambiguous", () => {
    const order = makeOrder({
      total: 220,
      items: [makeItem("A", 100), makeItem("B", 100)],
      charges: [{ date: "2025-01-15", amount: 106, description: "Visa" }],
    });
    const txns = [makeTxn({ amount: -106 })];
    const result = matchAmazonOrders(txns, [order]);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]?.items).toHaveLength(2);
  });

  test("attaches the full item list when the charge covers the whole order", () => {
    const order = makeOrder({
      total: 150,
      items: [makeItem("A", 100), makeItem("B", 40)],
      charges: [{ date: "2025-01-15", amount: 150, description: "Visa" }],
    });
    const txns = [makeTxn({ amount: -150 })];
    const result = matchAmazonOrders(txns, [order]);

    expect(result.matched[0]?.items).toHaveLength(2);
  });

  test("refund transaction matches a negative charge; sign mismatch does not", () => {
    const order = makeOrder({
      charges: [{ date: "2025-01-15", amount: -50, description: "Refund" }],
    });
    const refundTxn = makeTxn({ id: "t-refund", amount: 50 });
    const expenseTxn = makeTxn({
      id: "t-expense",
      amount: -50,
      date: "2025-01-15",
    });
    const result = matchAmazonOrders([refundTxn, expenseTxn], [order]);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]?.transaction.id).toBe("t-refund");
  });

  test("fallback picks the nearest-date order among equal totals", () => {
    const near = makeOrder({ orderId: "near", date: "2025-01-16" });
    const far = makeOrder({ orderId: "far", date: "2025-01-12" });
    const txns = [makeTxn({ date: "2025-01-15" })];
    const result = matchAmazonOrders(txns, [far, near]);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]?.order.orderId).toBe("near");
  });
});
