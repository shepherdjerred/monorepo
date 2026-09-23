import { parseCsvRows } from "../csv/rows.ts";
import type { LoanSplit } from "./types.ts";

// Edfinancial's "By Transaction" export, which states the split outright
// rather than leaving it to be derived from a balance series the way Upstart's
// mail does. Columns: Date, Description, Principal, Interest, Fees, Total.
//
// Two shapes need care. The file is served with an HTML doctype glued to the
// header line, so the header is found rather than assumed to be first. And a
// servicer correction appears as two rows on one date — a reversal with
// positive amounts and the corrected payment — which only reconcile when the
// date is netted. Measured over the whole file, netting by date makes
// principal + interest equal the total on all 35 dates, and leaves the
// 2025-07-20 correction at $92.75 + $99.16 = $191.91, in line with its
// neighbours.

const HEADER_FIELD = "Date";
const PAYMENT = "PAYMENT";
const DISBURSEMENT = "DISBURSEMENT";
const CAPITALIZED_INTEREST = "CAPITALIZED INTEREST";
// The servicer names no account number in this export, so the loan is
// identified by the servicer itself. It services one loan here.
export const EDFINANCIAL_LOAN_ID = "Edfinancial";
const CENT = 0.005;

function parseUsDate(raw: string): string | undefined {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw.trim());
  return match === null
    ? undefined
    : `${match[3] ?? ""}-${match[1] ?? ""}-${match[2] ?? ""}`;
}

function parseMoney(raw: string): number {
  const cleaned = raw.replaceAll("$", "").replaceAll(",", "").trim();
  if (cleaned === "") return 0;
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) ? value : 0;
}

// Netting a date and running a balance across 35 payments accumulates binary
// error, and these numbers are written into notes and split legs. Cents are
// the unit the servicer states, so cents are what is carried.
function toCents(value: number): number {
  return Math.round(value * 100) / 100;
}

type Ledger = {
  // Money owed, by date, netted across same-day corrections. Amounts are the
  // servicer's signs: a payment is negative.
  payments: Map<string, { principal: number; interest: number; total: number }>;
  // What was lent, plus anything capitalized onto it.
  principalAdvanced: number;
};

function readLedger(text: string): Ledger {
  const payments = new Map<
    string,
    { principal: number; interest: number; total: number }
  >();
  let principalAdvanced = 0;

  for (const fields of parseCsvRows(text)) {
    // The doctype is prepended to the header, so the header's own date column
    // never parses and the row falls out here along with it.
    if ((fields[0] ?? "").trim().endsWith(HEADER_FIELD)) continue;
    const date = parseUsDate(fields[0] ?? "");
    if (date === undefined) continue;

    const description = (fields[1] ?? "").trim();
    const principal = parseMoney(fields[2] ?? "");
    const interest = parseMoney(fields[3] ?? "");
    const total = parseMoney(fields[5] ?? "");

    if (description === DISBURSEMENT || description === CAPITALIZED_INTEREST) {
      principalAdvanced += principal;
      continue;
    }
    if (description !== PAYMENT) continue;

    const running = payments.get(date) ?? {
      principal: 0,
      interest: 0,
      total: 0,
    };
    payments.set(date, {
      principal: running.principal + principal,
      interest: running.interest + interest,
      total: running.total + total,
    });
  }

  return { payments, principalAdvanced };
}

export function parseEdfinancialCsv(text: string): LoanSplit[] {
  const { payments, principalAdvanced } = readLedger(text);
  const splits: LoanSplit[] = [];
  let balance = principalAdvanced;

  for (const [date, netted] of [...payments.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    // A date that nets to nothing is a reversal with no surviving payment.
    if (Math.abs(netted.total) < CENT) continue;
    const principal = toCents(-netted.principal);
    const interest = toCents(-netted.interest);
    const amount = toCents(-netted.total);

    // The servicer states all three, so they must agree. A file where they do
    // not has a column this parser has misread, and writing a split from it
    // would put a wrong number on a real transaction.
    if (Math.abs(principal + interest - amount) > CENT) {
      throw new Error(
        `Edfinancial ${date}: principal ${principal.toFixed(2)} + interest ${interest.toFixed(2)} is not the ${amount.toFixed(2)} paid`,
      );
    }

    balance = toCents(balance - principal);
    splits.push({
      loanId: EDFINANCIAL_LOAN_ID,
      date,
      amount,
      principal,
      interest,
      balanceAfter: balance,
      origin: "stated",
    });
  }

  return splits;
}
