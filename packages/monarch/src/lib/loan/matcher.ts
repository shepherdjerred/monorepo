import type { MonarchTransaction } from "../monarch/types.ts";
import type { LoanSplit } from "./types.ts";

export type LoanMatch = {
  transaction: MonarchTransaction;
  split: LoanSplit;
};

export type LoanMatchResult = {
  matched: LoanMatch[];
  unmatched: MonarchTransaction[];
};

// The servicer's confirmation names the day it applied the payment; the bank
// posts it within a few days either side.
const DATE_WINDOW_DAYS = 6;
// The amount is the servicer's own figure for the same payment, so it agrees
// to the cent. Anything looser would let one month's payment match another's.
const AMOUNT_TOLERANCE = 0.005;

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000;
}

function splitKey(split: LoanSplit): string {
  return `${split.loanId}|${split.date}|${String(split.amount)}`;
}

// The derived split closest in date whose amount is the payment's. Nearest,
// not first found: the same amount recurs every month, so first-fit would pair
// a payment with an adjacent month's.
//
// A tie is refused rather than broken. Up to five Upstart loans ran at once
// with identical payment amounts, so two splits can sit the same distance from
// one transaction; picking either writes a loan id, a principal and an
// interest figure that belong to the other loan. An unmatched payment is
// reported and stays whole, which is recoverable; a confidently wrong split is
// not.
function nearestSplit(
  transaction: MonarchTransaction,
  splits: LoanSplit[],
  used: Set<string>,
): LoanSplit | undefined {
  const amount = Math.abs(transaction.amount);
  let best: { split: LoanSplit; distance: number } | undefined;
  let tied = false;
  for (const split of splits) {
    if (used.has(splitKey(split))) continue;
    if (Math.abs(split.amount - amount) > AMOUNT_TOLERANCE) continue;
    const distance = daysBetween(transaction.date, split.date);
    if (distance > DATE_WINDOW_DAYS) continue;
    if (best === undefined || distance < best.distance) {
      best = { split, distance };
      tied = false;
    } else if (
      distance === best.distance &&
      split.loanId !== best.split.loanId
    ) {
      tied = true;
    }
  }
  return tied ? undefined : best?.split;
}

export function matchLoanPayments(
  transactions: MonarchTransaction[],
  splits: LoanSplit[],
): LoanMatchResult {
  const matched: LoanMatch[] = [];
  const unmatched: MonarchTransaction[] = [];
  const used = new Set<string>();

  // A transaction a previous run already split must never be split again, and
  // nothing downstream re-checks this — `apply.ts` only sees the change.
  const eligible = transactions
    .filter((t) => !t.isSplitTransaction && t.amount < 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Transactions posting on the servicer's own payment date claim their split
  // first. Otherwise an earlier transaction several days away could consume a
  // split that a later one matches exactly, and greedy order would decide
  // which loan each belongs to.
  const remaining: MonarchTransaction[] = [];
  for (const transaction of eligible) {
    const sameDay = splits.filter(
      (s) =>
        !used.has(splitKey(s)) &&
        s.date === transaction.date &&
        Math.abs(s.amount - Math.abs(transaction.amount)) <= AMOUNT_TOLERANCE,
    );
    // Two loans paying the same amount on the same day are indistinguishable
    // from the bank row alone; leave both for the reported-gap path.
    const exact = sameDay.length === 1 ? sameDay[0] : undefined;
    if (exact === undefined) {
      remaining.push(transaction);
      continue;
    }
    used.add(splitKey(exact));
    matched.push({ transaction, split: exact });
  }

  for (const transaction of remaining) {
    const split = nearestSplit(transaction, splits, used);
    if (split === undefined) {
      unmatched.push(transaction);
      continue;
    }
    used.add(splitKey(split));
    matched.push({ transaction, split });
  }

  matched.sort((a, b) => a.transaction.date.localeCompare(b.transaction.date));
  return { matched, unmatched };
}
