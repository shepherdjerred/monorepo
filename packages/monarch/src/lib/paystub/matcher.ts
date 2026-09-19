import type { Payslip } from "./types.ts";
import type { MonarchTransaction } from "../monarch/types.ts";

export type PaystubMatch = {
  transaction: MonarchTransaction;
  payslip: Payslip;
};

export type PaystubMatchResult = {
  matched: PaystubMatch[];
  // Deposits paired to a payslip by date whose amount does not equal net pay.
  // This is the verification feature, not a fallback.
  amountMismatches: PaystubMatch[];
  unmatchedTransactions: MonarchTransaction[];
  unmatchedPayslips: Payslip[];
};

const AMOUNT_TOLERANCE = 0.01;
// Direct deposit can land a couple of business days either side of the
// printed pay date around weekends and holidays.
const DATE_WINDOW_DAYS = 3;
const MISMATCH_WINDOW_DAYS = 1;

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000;
}

// Nearest pay date whose net equals the deposit exactly.
function nearestExactPayslip(
  transaction: MonarchTransaction,
  payslips: Payslip[],
  used: Set<Payslip>,
): { payslip: Payslip; dateDiff: number } | undefined {
  let best: { payslip: Payslip; dateDiff: number } | undefined;
  for (const payslip of payslips) {
    if (used.has(payslip)) continue;
    const dateDiff = daysBetween(transaction.date, payslip.payDate);
    if (dateDiff > DATE_WINDOW_DAYS) continue;
    if (Math.abs(transaction.amount - payslip.netPay) > AMOUNT_TOLERANCE) {
      continue;
    }
    if (best === undefined || dateDiff < best.dateDiff) {
      best = { payslip, dateDiff };
    }
  }
  return best;
}

export function matchPayslips(
  transactions: MonarchTransaction[],
  allPayslips: Payslip[],
): PaystubMatchResult {
  const matched: PaystubMatch[] = [];
  const amountMismatches: PaystubMatch[] = [];
  // Claimed payslips, by record rather than by pay date: Workday can issue a
  // regular and a supplemental payslip on the same day, and each has its own
  // deposit. Retiring the date would leave the second deposit unmatched even
  // when its net agrees to the cent.
  const used = new Set<Payslip>();
  const matchedTransactionIds = new Set<string>();

  // A supplemental payslip for an equity release nets to zero — the shares are
  // the payment and the withholding consumes the rest, so nothing is deposited
  // and no transaction can exist. Reporting those as missing would bury the
  // deposits that really are unaccounted for.
  const payslips = allPayslips.filter((p) => p.netPay > 0);

  // Payroll deposits only; a payslip never corresponds to money leaving.
  const eligible = transactions
    .filter((t) => !t.isSplitTransaction && t.amount > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const transaction of eligible) {
    const best = nearestExactPayslip(transaction, payslips, used);
    if (best) {
      used.add(best.payslip);
      matchedTransactionIds.add(transaction.id);
      matched.push({ transaction, payslip: best.payslip });
    }
  }

  // Second pass: a payslip whose net never matched a deposit exactly, paired
  // to a same-day deposit. Surfacing these is the point — a net that differs
  // from what actually arrived is worth a human look.
  for (const transaction of eligible) {
    if (matchedTransactionIds.has(transaction.id)) continue;
    const payslip = payslips.find(
      (p) =>
        !used.has(p) &&
        daysBetween(transaction.date, p.payDate) <= MISMATCH_WINDOW_DAYS,
    );
    if (payslip === undefined) continue;
    used.add(payslip);
    matchedTransactionIds.add(transaction.id);
    amountMismatches.push({ transaction, payslip });
  }

  return {
    matched,
    amountMismatches,
    unmatchedTransactions: eligible.filter(
      (t) => !matchedTransactionIds.has(t.id),
    ),
    unmatchedPayslips: payslips.filter((p) => !used.has(p)),
  };
}

// A raise is not an error, so it is reported in the note rather than flagged.
export function grossChangePercent(
  payslip: Payslip,
  previous: Payslip | undefined,
): number | undefined {
  if (previous === undefined || previous.grossPay === 0) return undefined;
  const change =
    ((payslip.grossPay - previous.grossPay) / previous.grossPay) * 100;
  return Math.abs(change) < 0.5 ? undefined : change;
}
