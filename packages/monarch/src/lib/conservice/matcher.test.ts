import { describe, expect, test } from "vitest";
import { groupByMonth, matchBiltTransactions } from "./matcher.ts";
import type { ConserviceCharge, ConserviceMonthSummary } from "./types.ts";
import type { MonarchTransaction } from "../monarch/types.ts";

function makeCharge(
  overrides: Partial<ConserviceCharge> = {},
): ConserviceCharge {
  return {
    billId: "2026-03",
    rowNumber: 1,
    description: "Rent",
    chargeAmount: 2000,
    paymentAmount: 0,
    monthTotal: 0,
    postMonth: "2026-03-01",
    transactionDate: "2026-03-01",
    chargeTypeId: 19,
    ...overrides,
  };
}

function makeTxn(
  overrides: Partial<MonarchTransaction> = {},
): MonarchTransaction {
  return {
    id: "txn-1",
    amount: -4900,
    pending: false,
    date: "2026-03-01",
    hideFromReports: false,
    plaidName: "BILT",
    notes: "",
    isRecurring: false,
    reviewStatus: "none",
    needsReview: false,
    isSplitTransaction: false,
    createdAt: "2026-03-01",
    updatedAt: "2026-03-01",
    category: { id: "cat-1", name: "Rent" },
    merchant: { id: "m-1", name: "Bilt", transactionsCount: 12 },
    account: { id: "a-1", displayName: "Checking" },
    tags: [],
    ...overrides,
  };
}

describe("groupByMonth", () => {
  test("groups the API's several post months into one monthly bill", () => {
    const charges = [
      makeCharge({
        billId: "2026-03",
        postMonth: "2026-03-01",
        chargeTypeId: 19,
        chargeAmount: 2000,
      }),
      makeCharge({
        billId: "2026-03",
        postMonth: "2026-03-15",
        chargeTypeId: 112,
        chargeAmount: 50,
      }),
      makeCharge({
        billId: "2026-04",
        postMonth: "2026-04-01",
        chargeTypeId: 19,
        chargeAmount: 2000,
      }),
    ];

    const result = groupByMonth(charges);
    expect(result).toHaveLength(2);
    expect(result[0]?.month).toBe("2026-03");
    expect(result[1]?.month).toBe("2026-04");
  });

  test("categorizes charges correctly", () => {
    const charges = [
      makeCharge({ chargeTypeId: 19, chargeAmount: 2000 }),
      makeCharge({ chargeTypeId: 137, chargeAmount: 150 }),
      makeCharge({ chargeTypeId: 112, chargeAmount: 50 }),
      makeCharge({ chargeTypeId: 1, chargeAmount: 30 }),
      makeCharge({ chargeTypeId: 6, chargeAmount: 80 }),
      makeCharge({ chargeTypeId: 3, chargeAmount: 25 }),
    ];

    const result = groupByMonth(charges);
    expect(result).toHaveLength(1);

    const month = result[0];
    expect(month?.rent).toBe(2150);
    expect(month?.pets).toBe(50);
    expect(month?.waterSewer).toBe(30);
    expect(month?.electric).toBe(80);
    expect(month?.trash).toBe(25);
  });

  test("uses MonthTotal when available", () => {
    const charges = [
      makeCharge({ chargeTypeId: 19, chargeAmount: 2000, monthTotal: 2500 }),
      makeCharge({ chargeTypeId: 112, chargeAmount: 50, monthTotal: 0 }),
    ];

    const result = groupByMonth(charges);
    expect(result[0]?.total).toBe(2500);
  });

  test("sums charges when no MonthTotal", () => {
    const charges = [
      makeCharge({ chargeTypeId: 19, chargeAmount: 2000, monthTotal: 0 }),
      makeCharge({ chargeTypeId: 112, chargeAmount: 50, monthTotal: 0 }),
    ];

    const result = groupByMonth(charges);
    expect(result[0]?.total).toBe(2050);
  });

  test("keeps a move-out final statement out of that month's regular bill", () => {
    // Both bills fall in April. Summing them would report $5,154.58 due, which
    // neither the $4,887.67 regular payment nor the $266.91 final payment can
    // match, and would attribute the final statement's water and trash to the
    // regular month.
    const charges = [
      makeCharge({
        billId: "2026-04-01",
        postMonth: "2026-04-01",
        chargeTypeId: 19,
        chargeAmount: 4887.67,
      }),
      makeCharge({
        billId: "2026-04-24",
        postMonth: "2026-04-24",
        chargeTypeId: 1,
        chargeAmount: 246.64,
      }),
      makeCharge({
        billId: "2026-04-24",
        postMonth: "2026-04-24",
        chargeTypeId: 3,
        chargeAmount: 20.27,
      }),
    ];

    const result = groupByMonth(charges);
    expect(result).toHaveLength(2);
    expect(result[0]?.total).toBeCloseTo(4887.67, 2);
    expect(result[1]?.total).toBeCloseTo(266.91, 2);
    // Both are April, so both remain candidates for an April payment.
    expect(result.map((r) => r.month)).toEqual(["2026-04", "2026-04"]);
  });

  test("includes service fees in rent", () => {
    const charges = [
      makeCharge({ chargeTypeId: 19, chargeAmount: 2000 }),
      makeCharge({ chargeTypeId: 4, chargeAmount: 10 }),
    ];

    const result = groupByMonth(charges);
    expect(result[0]?.rent).toBe(2010);
  });
});

function makeMonth(
  overrides: Partial<ConserviceMonthSummary> = {},
): ConserviceMonthSummary {
  return {
    billId: "2026-03",
    month: "2026-03",
    total: 4900,
    rent: 4500,
    pets: 50,
    waterSewer: 100,
    electric: 200,
    trash: 50,
    charges: [],
    ...overrides,
  };
}

describe("matchBiltTransactions", () => {
  test("matches transaction to month by date and amount", () => {
    const txns = [makeTxn({ amount: -4900, date: "2026-03-15" })];
    const months = [makeMonth()];

    const result = matchBiltTransactions(txns, months);
    expect(result).toHaveLength(1);
    expect(result[0]?.monarchTransaction.id).toBe("txn-1");
    expect(result[0]?.month.month).toBe("2026-03");
  });

  test("matches within $1 tolerance", () => {
    const txns = [makeTxn({ amount: -4900.5, date: "2026-03-15" })];
    const months = [makeMonth({ total: 4900 })];

    const result = matchBiltTransactions(txns, months);
    expect(result).toHaveLength(1);
  });

  test("does not match beyond $1 tolerance", () => {
    const txns = [makeTxn({ amount: -4905, date: "2026-03-15" })];
    const months = [makeMonth({ total: 4900 })];

    const result = matchBiltTransactions(txns, months);
    expect(result).toHaveLength(0);
  });

  test("does not match different months", () => {
    const txns = [makeTxn({ amount: -4900, date: "2026-04-15" })];
    const months = [makeMonth({ month: "2026-03" })];

    const result = matchBiltTransactions(txns, months);
    expect(result).toHaveLength(0);
  });

  test("skips split transactions", () => {
    const txns = [makeTxn({ isSplitTransaction: true })];
    const months = [makeMonth()];

    const result = matchBiltTransactions(txns, months);
    expect(result).toHaveLength(0);
  });

  test("generates splits for non-zero amounts only", () => {
    const txns = [makeTxn({ amount: -4700, date: "2026-03-15" })];
    const months = [
      makeMonth({
        total: 4700,
        rent: 4500,
        pets: 0,
        waterSewer: 100,
        electric: 100,
        trash: 0,
      }),
    ];

    const result = matchBiltTransactions(txns, months);
    expect(result).toHaveLength(1);
    expect(result[0]?.splits).toHaveLength(3);
    expect(result[0]?.splits).toEqual([
      { category: "Rent", amount: 4500 },
      { category: "Water", amount: 100 },
      { category: "Gas & Electric", amount: 100 },
    ]);
  });
});

function marchBill(
  billId: string,
  total: number,
  rent: number,
): ConserviceMonthSummary {
  return {
    billId,
    month: "2026-03",
    total,
    rent,
    pets: 0,
    waterSewer: 0,
    electric: 0,
    trash: 0,
    charges: [],
  };
}

describe("matchBiltTransactions — two bills in one month", () => {
  test("claims each bill once instead of giving both payments the first", () => {
    // Within the $1 tolerance both transactions used to select the first
    // sorted bill and take its breakdown, leaving the second bill unused.
    const matches = matchBiltTransactions(
      [
        makeTxn({ id: "txn-a", amount: -4900 }),
        makeTxn({ id: "txn-b", amount: -4900.5 }),
      ],
      [
        marchBill("2026-03-a", 4900, 4900),
        marchBill("2026-03-b", 4900.5, 4900.5),
      ],
    );

    expect(matches).toHaveLength(2);
    expect(new Set(matches.map((m) => m.month.billId)).size).toBe(2);
  });
});
