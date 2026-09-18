import { describe, expect, test } from "vitest";
import { matchPayslips, grossChangePercent } from "./matcher.ts";
import type { Payslip } from "./types.ts";
import type { MonarchTransaction } from "../monarch/types.ts";

function payslip(payDate: string, netPay: number, grossPay = 8000): Payslip {
  return {
    payDate,
    periodStart: payDate,
    periodEnd: payDate,
    hours: 0,
    grossPay,
    preTaxDeductions: 0,
    employeeTaxes: 0,
    postTaxDeductions: 0,
    netPay,
    earnings: [],
    taxes: [],
    deductions: [],
    sourcePage: 1,
  };
}

function deposit(
  date: string,
  amount: number,
  overrides: Partial<MonarchTransaction> = {},
): MonarchTransaction {
  return {
    id: `t-${date}-${String(amount)}`,
    amount,
    pending: false,
    date,
    hideFromReports: false,
    plaidName: "PINTEREST PAYROLL",
    notes: "",
    isRecurring: false,
    reviewStatus: "none",
    needsReview: false,
    isSplitTransaction: false,
    createdAt: date,
    updatedAt: date,
    category: { id: "c", name: "Paychecks" },
    merchant: { id: "m", name: "Pinterest Inc", transactionsCount: 1 },
    account: { id: "a", displayName: "SoFi Checking" },
    tags: [],
    ...overrides,
  };
}

describe("matchPayslips", () => {
  test("matches a deposit to the payslip with the same net", () => {
    const result = matchPayslips(
      [deposit("2026-09-15", 6122.11)],
      [payslip("2026-09-15", 6122.11)],
    );
    expect(result.matched).toHaveLength(1);
    expect(result.amountMismatches).toHaveLength(0);
  });

  test("allows a few days of direct-deposit drift", () => {
    const result = matchPayslips(
      [deposit("2026-09-17", 6122.11)],
      [payslip("2026-09-15", 6122.11)],
    );
    expect(result.matched).toHaveLength(1);
  });

  test("does not match beyond the window", () => {
    const result = matchPayslips(
      [deposit("2026-09-22", 6122.11)],
      [payslip("2026-09-15", 6122.11)],
    );
    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedTransactions).toHaveLength(1);
  });

  test("a deposit that differs from net is surfaced, not matched", () => {
    const result = matchPayslips(
      [deposit("2026-09-15", 6000)],
      [payslip("2026-09-15", 6122.11)],
    );
    expect(result.matched).toHaveLength(0);
    expect(result.amountMismatches).toHaveLength(1);
    expect(result.amountMismatches[0]?.payslip.netPay).toBe(6122.11);
  });

  test("ignores outgoing amounts and already-split transactions", () => {
    const result = matchPayslips(
      [
        deposit("2026-09-15", -6122.11),
        deposit("2026-09-15", 6122.11, { isSplitTransaction: true }),
      ],
      [payslip("2026-09-15", 6122.11)],
    );
    expect(result.matched).toHaveLength(0);
  });

  test("two identical nets in one window do not both take the same payslip", () => {
    const result = matchPayslips(
      [deposit("2026-09-15", 5000), deposit("2026-09-16", 5000)],
      [payslip("2026-09-15", 5000)],
    );
    expect(result.matched).toHaveLength(1);
  });

  test("reports payslips with no corresponding deposit", () => {
    const result = matchPayslips([], [payslip("2026-09-15", 6122.11)]);
    expect(result.unmatchedPayslips).toHaveLength(1);
  });

  test("a payslip that nets to zero is not a missing deposit", () => {
    // An equity release: the shares are the payment and withholding takes the
    // rest, so no money ever reaches the account.
    const result = matchPayslips([], [payslip("2026-06-23", 0, 51_060.13)]);
    expect(result.unmatchedPayslips).toHaveLength(0);
  });
});

describe("grossChangePercent", () => {
  test("reports a raise", () => {
    const change = grossChangePercent(
      payslip("2026-09-15", 6000, 8645),
      payslip("2026-08-31", 6000, 8000),
    );
    expect(change).toBeCloseTo(8.06, 1);
  });

  test("ignores noise below half a percent", () => {
    expect(
      grossChangePercent(
        payslip("2026-09-15", 6000, 8000),
        payslip("2026-08-31", 6000, 8010),
      ),
    ).toBeUndefined();
  });

  test("has nothing to compare for the first payslip", () => {
    expect(
      grossChangePercent(payslip("2026-09-15", 6000, 8000), undefined),
    ).toBeUndefined();
  });
});
