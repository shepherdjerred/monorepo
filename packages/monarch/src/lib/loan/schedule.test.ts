import { describe, expect, test } from "vitest";
import { deriveLoanSchedule } from "./schedule.ts";
import type { LoanBalance, LoanPayment } from "./types.ts";

function balances(loanId: string, points: [string, number][]): LoanBalance[] {
  return points.map(([asOf, outstandingPrincipal]) => ({
    loanId,
    asOf,
    outstandingPrincipal,
  }));
}

function payments(loanId: string, points: [string, number][]): LoanPayment[] {
  return points.map(([date, amount]) => ({ loanId, date, amount }));
}

describe("deriveLoanSchedule", () => {
  // Real figures from the servicer's own statements. The principal share
  // rising month over month is the amortization curve.
  test("splits a payment the way the balance says it was applied", () => {
    const { splits, gaps } = deriveLoanSchedule(
      balances("L1025211", [
        ["2022-06-30", 21_500],
        ["2022-07-30", 21_247.94],
        ["2022-08-30", 21_000.72],
      ]),
      payments("L1025211", [
        ["2022-07-22", 526.74],
        ["2022-08-22", 526.74],
      ]),
    );
    expect(gaps).toHaveLength(0);
    expect(splits).toEqual([
      {
        loanId: "L1025211",
        date: "2022-07-22",
        amount: 526.74,
        principal: 252.06,
        interest: 274.68,
        balanceAfter: 21_247.94,
        origin: "derived",
      },
      {
        loanId: "L1025211",
        date: "2022-08-22",
        amount: 526.74,
        principal: 247.22,
        interest: 279.52,
        balanceAfter: 21_000.72,
        origin: "derived",
      },
    ]);
  });

  test("the legs always sum to the payment", () => {
    const { splits } = deriveLoanSchedule(
      balances("IC7213772", [
        ["2026-07-29", 18_896.05],
        ["2026-08-29", 17_830.97],
      ]),
      payments("IC7213772", [["2026-08-04", 1254.9]]),
    );
    const [split] = splits;
    expect(split?.principal).toBe(1065.08);
    expect(split?.interest).toBe(189.82);
    expect((split?.principal ?? 0) + (split?.interest ?? 0)).toBeCloseTo(
      1254.9,
      2,
    );
  });

  test("two payments in one window are reported, not apportioned", () => {
    // A lump payment alongside the scheduled one: the two share a single
    // balance drop and there is no honest way to divide it.
    const { splits, gaps } = deriveLoanSchedule(
      balances("IC7213772", [
        ["2026-06-01", 48_000],
        ["2026-07-01", 17_000],
      ]),
      payments("IC7213772", [
        ["2026-06-25", 30_000],
        ["2026-06-05", 1254.9],
      ]),
    );
    expect(splits).toHaveLength(0);
    expect(gaps[0]?.reason).toContain("2 payments");
  });

  test("a window with no payment yields nothing and no complaint", () => {
    const { splits, gaps } = deriveLoanSchedule(
      balances("L1", [
        ["2026-01-01", 1000],
        ["2026-02-01", 1000],
      ]),
      [],
    );
    expect(splits).toHaveLength(0);
    expect(gaps).toHaveLength(0);
  });

  // The bug that prompted the guards: one loan's balances differenced against
  // another loan's payment. Principal exceeded the amount paid, which is
  // impossible, and an earlier draft happily reported negative interest.
  test("never reports principal larger than the payment", () => {
    const { splits, gaps } = deriveLoanSchedule(
      balances("IC4218953", [
        ["2025-08-21", 18_343.67],
        ["2025-09-21", 17_618.05],
      ]),
      payments("IC4218953", [["2025-09-10", 526.74]]),
    );
    expect(splits).toHaveLength(0);
    expect(gaps[0]?.reason).toContain("exceeds");
  });

  test("a balance that did not fall is reported", () => {
    const { splits, gaps } = deriveLoanSchedule(
      balances("L1", [
        ["2026-01-01", 1000],
        ["2026-02-01", 1010],
      ]),
      payments("L1", [["2026-01-15", 50]]),
    );
    expect(splits).toHaveLength(0);
    expect(gaps[0]?.reason).toContain("did not fall");
  });

  test("keeps concurrent loans apart", () => {
    const { splits } = deriveLoanSchedule(
      [
        ...balances("A", [
          ["2026-01-01", 5000],
          ["2026-02-01", 4600],
        ]),
        ...balances("B", [
          ["2026-01-01", 9000],
          ["2026-02-01", 8100],
        ]),
      ],
      [
        ...payments("A", [["2026-01-15", 500]]),
        ...payments("B", [["2026-01-20", 1000]]),
      ],
    );
    expect(splits).toEqual([
      expect.objectContaining({ loanId: "A", principal: 400, interest: 100 }),
      expect.objectContaining({ loanId: "B", principal: 900, interest: 100 }),
    ]);
  });

  test("clamps a sub-cent negative interest so the legs still sum", () => {
    const { splits } = deriveLoanSchedule(
      balances("L1", [
        ["2026-01-01", 1000],
        ["2026-02-01", 899.996],
      ]),
      payments("L1", [["2026-01-15", 100]]),
    );
    expect(splits[0]?.interest).toBe(0);
  });
});
