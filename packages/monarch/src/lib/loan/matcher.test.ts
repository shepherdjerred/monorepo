import { describe, expect, test } from "vitest";
import { matchLoanPayments } from "./matcher.ts";
import type { LoanSplit } from "./types.ts";
import type { MonarchTransaction } from "../monarch/types.ts";

function split(
  loanId: string,
  date: string,
  amount: number,
  principal = amount / 2,
): LoanSplit {
  return {
    loanId,
    date,
    amount,
    principal,
    interest: amount - principal,
    balanceAfter: 10_000,
  };
}

function payment(
  id: string,
  date: string,
  amount: number,
  overrides: Partial<MonarchTransaction> = {},
): MonarchTransaction {
  return {
    id,
    amount: -amount,
    pending: false,
    date,
    hideFromReports: false,
    plaidName: "UPSTART NETWORK",
    notes: "",
    isRecurring: true,
    reviewStatus: "none",
    needsReview: false,
    isSplitTransaction: false,
    createdAt: date,
    updatedAt: date,
    category: { id: "c", name: "Loan Repayment" },
    merchant: { id: "m", name: "Upstart", transactionsCount: 41 },
    account: { id: "a", displayName: "SoFi Checking" },
    tags: [],
    ...overrides,
  };
}

describe("matchLoanPayments", () => {
  test("pairs a payment with the servicer's split for that day", () => {
    const result = matchLoanPayments(
      [payment("t1", "2026-09-05", 1254.9)],
      [split("IC7213772", "2026-09-05", 1254.9, 1065.08)],
    );

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]?.split.loanId).toBe("IC7213772");
    expect(result.unmatched).toHaveLength(0);
  });

  test("never re-splits a transaction a previous run already split", () => {
    const result = matchLoanPayments(
      [payment("t1", "2026-09-05", 1254.9, { isSplitTransaction: true })],
      [split("IC7213772", "2026-09-05", 1254.9)],
    );

    expect(result.matched).toHaveLength(0);
    expect(result.unmatched).toHaveLength(0);
  });
});

describe("matchLoanPayments — concurrent loans of equal payment", () => {
  // Five Upstart loans ran at once, all recorded under one merchant, several
  // with the same monthly amount. Choosing between them wrongly writes another
  // loan's id, principal and interest onto the transaction.
  test("refuses a payment that two loans explain equally well", () => {
    const result = matchLoanPayments(
      [payment("t-mid", "2026-09-04", 526.74)],
      [
        split("L1025211", "2026-09-03", 526.74),
        split("L2088417", "2026-09-05", 526.74),
      ],
    );

    expect(result.matched).toHaveLength(0);
    expect(result.unmatched.map((t) => t.id)).toEqual(["t-mid"]);
  });

  test("a payment posting on the servicer's date claims its own split first", () => {
    // The nearby transaction is processed first by date, and greedy matching
    // would let it consume the Sep 5 split that the Sep 5 payment matches
    // exactly, forcing that payment onto the other loan.
    const result = matchLoanPayments(
      [
        payment("t-sep-02", "2026-09-02", 526.74),
        payment("t-sep-05", "2026-09-05", 526.74),
      ],
      [
        split("L1025211", "2026-09-01", 526.74),
        split("L2088417", "2026-09-05", 526.74),
      ],
    );

    expect(
      result.matched.map((m) => [m.transaction.id, m.split.loanId]),
    ).toEqual([
      ["t-sep-02", "L1025211"],
      ["t-sep-05", "L2088417"],
    ]);
  });
});

describe("matchLoanPayments — two payments on one loan", () => {
  test("refuses a transaction sitting equidistant between them", () => {
    // Not only concurrent loans tie: the same loan can take an extra payment
    // that happens to equal its monthly amount, and at the edges of the window
    // both sit the same distance away. Their principal and interest differ, so
    // choosing either is a guess with a number attached.
    const result = matchLoanPayments(
      [payment("t-mid", "2026-09-07", 526.74)],
      [
        split("L1025211", "2026-09-01", 526.74, 250),
        split("L1025211", "2026-09-13", 526.74, 260),
      ],
    );

    expect(result.matched).toHaveLength(0);
    expect(result.unmatched.map((t) => t.id)).toEqual(["t-mid"]);
  });
});
