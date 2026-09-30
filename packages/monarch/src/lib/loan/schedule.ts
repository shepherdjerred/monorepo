import type { LoanBalance, LoanGap, LoanPayment, LoanSplit } from "./types.ts";

// Derives how each payment was applied, from what the servicer stated.
//
// A loan statement never prints "this payment was $X principal and $Y
// interest", but it prints the outstanding principal every month. The drop
// between two consecutive statements is the principal the payment retired;
// everything else the payment covered was interest. That is arithmetic on
// figures the lender published, not an inference.
//
// The whole difficulty is attribution. Several loans can be open at once and
// the bank records every payment under one merchant, so differencing one
// loan's balances against another loan's payment produces nonsense — it
// produced $725.62 of principal against a $526.74 payment, which is what
// prompted the guards below. Payments therefore arrive already named to a
// loan, and each loan is reduced on its own.

const CENT = 0.005;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function byDate<T extends { date: string }>(a: T, b: T): number {
  return a.date.localeCompare(b.date);
}

export type LoanSchedule = {
  splits: LoanSplit[];
  gaps: LoanGap[];
};

type WindowOutcome =
  | { kind: "split"; split: LoanSplit }
  | { kind: "gap"; reason: string }
  | { kind: "skip" };

// What one pair of consecutive statements says about the payment between them.
function deriveWindow(
  loanId: string,
  before: LoanBalance,
  after: LoanBalance,
  window: LoanPayment[],
): WindowOutcome {
  // Two payments in one window share a single balance drop, and there is no
  // honest way to say how much of it each retired. A lump payment alongside
  // the scheduled one is exactly this case.
  if (window.length > 1) {
    return {
      kind: "gap",
      reason: `${String(window.length)} payments fall between these statements; the balance drop cannot be attributed to one of them`,
    };
  }
  const payment = window[0];
  if (payment === undefined) return { kind: "skip" };

  const principal = round(
    before.outstandingPrincipal - after.outstandingPrincipal,
  );
  const interest = round(payment.amount - principal);

  // Each of these means the two sides describe different things — a
  // re-amortization, a correction, or a payment attributed to the wrong loan.
  // None is a rounding artefact, so none is recoverable.
  if (principal <= 0) {
    return {
      kind: "gap",
      reason: `balance did not fall (${principal.toFixed(2)})`,
    };
  }
  if (interest < -CENT) {
    return {
      kind: "gap",
      reason: `principal ${principal.toFixed(2)} exceeds the ${payment.amount.toFixed(2)} paid`,
    };
  }

  return {
    kind: "split",
    split: {
      loanId,
      date: payment.date,
      amount: payment.amount,
      principal,
      // A hair of negative interest is a rounding artefact; clamp it so the
      // legs still sum to the payment exactly.
      interest: Math.max(0, interest),
      balanceAfter: after.outstandingPrincipal,
      origin: "derived",
    },
  };
}

export function deriveLoanSchedule(
  balances: LoanBalance[],
  payments: LoanPayment[],
): LoanSchedule {
  const splits: LoanSplit[] = [];
  const gaps: LoanGap[] = [];

  for (const loanId of new Set(balances.map((b) => b.loanId))) {
    const series = balances
      .filter((b) => b.loanId === loanId)
      .sort((a, b) => a.asOf.localeCompare(b.asOf));
    const paid = payments.filter((p) => p.loanId === loanId).sort(byDate);

    for (let i = 1; i < series.length; i++) {
      const before = series[i - 1];
      const after = series[i];
      if (before === undefined || after === undefined) continue;

      const outcome = deriveWindow(
        loanId,
        before,
        after,
        paid.filter((p) => p.date > before.asOf && p.date <= after.asOf),
      );
      if (outcome.kind === "split") splits.push(outcome.split);
      if (outcome.kind === "gap") {
        gaps.push({
          loanId,
          from: before.asOf,
          to: after.asOf,
          reason: outcome.reason,
        });
      }
    }
  }

  return { splits: splits.sort(byDate), gaps };
}
