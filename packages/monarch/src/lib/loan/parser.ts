import { loadEmailIndex, readIndexedEmail } from "../mail/index.ts";
import { extractTextBody } from "../mail/parse.ts";
import { log } from "../logger.ts";
import type { LoanBalance, LoanPayment } from "./types.ts";

// Reads what the loan servicer emailed.
//
// Upstart sends two things worth keeping. A monthly reminder states the
// outstanding principal, and a payment confirmation names the loan, the amount
// and the date. Together they are an amortization schedule; neither is one on
// its own.
//
// Only Upstart is read here. Audi, Edfinancial, Hyundai and PenFed were
// checked — across 170 of their emails, none states principal or interest — so
// those lenders genuinely need their statements and cannot be derived from
// mail.

const SERVICER = /upstart/i;
// Loan ids seen: IC4218953, L1025211, FW2087434.
const LOAN_ID = /loan\s+(IC\d+|L\d{5,}|FW\d+)/i;
const LOAN_ID_LABELLED = /Loan ID:\s*(\S+)/i;
const OUTSTANDING = /Total outstanding principal[:\s]*\$([\d,]+\.\d{2})/i;
// "Your automatic payment of $1,254.90 on September 5, 2026 has been
// processed", and the one-time variant "We have applied a payment of $15 on
// July 24, 2026".
const PAYMENT =
  /payment of \$([\d,]+(?:\.\d{2})?) on ([a-z]{3,} \d{1,2}, \d{4})/i;

function money(raw: string): number {
  return Number.parseFloat(raw.replaceAll(",", ""));
}

function isoDate(printed: string): string | undefined {
  const parsed = new Date(printed);
  return Number.isNaN(parsed.getTime())
    ? undefined
    : parsed.toISOString().slice(0, 10);
}

export type LoanMail = {
  balances: LoanBalance[];
  payments: LoanPayment[];
};

// Both record types come out of one pass, because the same message can only be
// one of them and reading the mail twice would double the cost.
export function parseLoanEmail(
  body: string,
  receivedOn: string,
): Partial<LoanMail> {
  const loanId =
    LOAN_ID.exec(body)?.[1] ?? LOAN_ID_LABELLED.exec(body)?.[1] ?? undefined;
  if (loanId === undefined) return {};

  const outstanding = OUTSTANDING.exec(body);
  if (outstanding?.[1] !== undefined) {
    return {
      balances: [
        {
          loanId,
          asOf: receivedOn,
          outstandingPrincipal: money(outstanding[1]),
        },
      ],
    };
  }

  const payment = PAYMENT.exec(body);
  if (payment?.[1] === undefined || payment[2] === undefined) return {};
  const date = isoDate(payment[2]);
  return date === undefined
    ? {}
    : { payments: [{ loanId, date, amount: money(payment[1]) }] };
}

// The servicer resends the same reminder, so identical records collapse.
function dedupe<T>(records: T[], identity: (record: T) => string): T[] {
  return [...new Map(records.map((r) => [identity(r), r])).values()];
}

export async function loadLoanMail(): Promise<LoanMail> {
  const index = await loadEmailIndex();
  const servicerMail = index.filter((e) => SERVICER.test(e.from));
  log.info(`Found ${String(servicerMail.length)} loan servicer emails`);

  const balances: LoanBalance[] = [];
  const payments: LoanPayment[] = [];
  for (const entry of servicerMail) {
    const raw = await readIndexedEmail(entry);
    if (raw === undefined) continue;
    const body = extractTextBody(raw).replaceAll(/\s+/g, " ");
    const parsed = parseLoanEmail(body, entry.date.slice(0, 10));
    if (parsed.balances) balances.push(...parsed.balances);
    if (parsed.payments) payments.push(...parsed.payments);
  }

  const result = {
    balances: dedupe(
      balances,
      (b) => `${b.loanId}|${b.asOf}|${String(b.outstandingPrincipal)}`,
    ),
    payments: dedupe(
      payments,
      (p) => `${p.loanId}|${p.date}|${String(p.amount)}`,
    ),
  };
  log.info(
    `Parsed ${String(result.balances.length)} balance statements and ${String(result.payments.length)} payment confirmations across ${String(new Set(result.balances.map((b) => b.loanId)).size)} loans`,
  );
  return result;
}
