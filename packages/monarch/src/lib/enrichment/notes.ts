import type { EnrichedTransaction, TransactionEnrichment } from "./types.ts";
import { setTransactionNotes } from "../monarch/client.ts";
import { log } from "../logger.ts";

// Notes written by this pipeline start with this marker so re-runs can
// refresh them without ever clobbering a note the user wrote by hand.
export const NOTE_PREFIX = "🧾 ";

function money(amount: number): string {
  return `$${Math.abs(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function itemsNote(e: TransactionEnrichment): string | undefined {
  if (e.items === undefined || e.items.length === 0) return undefined;
  const label = e.enrichmentSource === "costco" ? "Costco" : "Amazon";
  const list = e.items.map((i) => `${i.title} (${money(i.price)})`).join(", ");
  return `${NOTE_PREFIX}${label}: ${list}`;
}

function billNote(e: TransactionEnrichment): string | undefined {
  if (e.billBreakdown === undefined || e.billBreakdown.length === 0) {
    return undefined;
  }
  const list = e.billBreakdown
    .map((b) => `${b.serviceType} ${money(b.amount)}`)
    .join("; ");
  return `${NOTE_PREFIX}Bilt bill: ${list}`;
}

function insuranceNote(e: TransactionEnrichment): string | undefined {
  if (e.insuranceLines === undefined || e.insuranceLines.length === 0) {
    return undefined;
  }
  const list = e.insuranceLines
    .map((l) => `${l.policyType} ${money(l.amount)}`)
    .join("; ");
  return `${NOTE_PREFIX}USAA: ${list}`;
}

function billingPeriodsNote(e: TransactionEnrichment): string | undefined {
  if (e.billingPeriods === undefined || e.billingPeriods.length === 0) {
    return undefined;
  }
  const list = e.billingPeriods
    .map((p) => `${p.period} ${money(p.amount)}`)
    .join("; ");
  return `${NOTE_PREFIX}Seattle City Light: ${list}`;
}

function receiptNote(e: TransactionEnrichment): string | undefined {
  if (e.receiptItems === undefined || e.receiptItems.length === 0) {
    return undefined;
  }
  const list = e.receiptItems
    .map((i) => `${i.title} (${money(i.price)})`)
    .join(", ");
  return `${NOTE_PREFIX}Apple receipt: ${list}`;
}

function venmoNote(e: TransactionEnrichment): string | undefined {
  if (e.paymentNote === undefined || e.paymentNote === "") return undefined;
  const direction = e.paymentDirection === "received" ? "from" : "to";
  return `${NOTE_PREFIX}Venmo ${direction} ${e.paymentCounterparty ?? "unknown"}: "${e.paymentNote}"`;
}

// Every paycheck carries base salary and a few dollars of imputed group-term
// life; naming those on all of them says nothing. The note calls out what
// makes a period unusual — a bonus, a stipend, an equity release.
const ROUTINE_EARNING = /^(?:regular salary|gtl\b)/i;

function notableEarnings(
  earnings: { label: string; amount: number }[],
): string[] {
  return earnings
    .filter((line) => !ROUTINE_EARNING.test(line.label) && line.amount > 0)
    .map((line) => `${line.label} ${money(line.amount)}`);
}

function paystubNote(e: TransactionEnrichment): string | undefined {
  const p = e.payslip;
  if (p === undefined) return undefined;
  const notable = notableEarnings(p.earnings);
  const parts = [
    `gross ${money(p.grossPay)} -> net ${money(p.netPay)}`,
    `taxes ${money(p.employeeTaxes)}`,
  ];
  if (p.preTaxDeductions > 0)
    parts.push(`pre-tax ${money(p.preTaxDeductions)}`);
  if (notable.length > 0) parts.push(`incl. ${notable.join(", ")}`);
  if (p.grossChangePercent !== undefined) {
    parts.push(
      `gross ${p.grossChangePercent > 0 ? "+" : ""}${p.grossChangePercent.toFixed(1)}% vs prior`,
    );
  }
  return `${NOTE_PREFIX}Paystub ${p.periodStart}..${p.periodEnd}: ${parts.join("; ")}`;
}

function shares(count: number): string {
  return count.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function vestNote(e: TransactionEnrichment): string | undefined {
  const v = e.vest;
  if (v === undefined) return undefined;
  const awards = `${String(v.awardCount)} award${v.awardCount === 1 ? "" : "s"}`;
  return (
    `${NOTE_PREFIX}RSU vest ${v.vestDate}: ${awards}, ${shares(v.shares)} sh ` +
    `@ ${money(v.fairMarketValue)} = ${money(v.grossValue)} gross; ` +
    `${shares(v.sharesWithheld)} sh withheld for taxes (${money(v.taxes)}); ` +
    `${shares(v.netShares)} net shares`
  );
}

function loanNote(e: TransactionEnrichment): string | undefined {
  const l = e.loan;
  if (l === undefined) return undefined;
  // A reconstructed split is worth marking as one: it is arithmetic across
  // two statements, not a figure the servicer printed.
  const qualifier = l.origin === "derived" ? " (derived)" : "";
  return (
    `${NOTE_PREFIX}Loan ${l.loanId}: ${money(l.principal)} principal + ` +
    `${money(l.interest)} interest${qualifier}; ${money(l.balanceAfter)} still owed`
  );
}

function brokerageNote(e: TransactionEnrichment): string | undefined {
  const b = e.brokerage;
  if (b === undefined) return undefined;
  if (b.kind === "interest") return `${NOTE_PREFIX}Brokerage interest`;
  if (b.symbol === undefined || b.quantity === undefined) {
    return `${NOTE_PREFIX}Transfer from the brokerage`;
  }
  // The gain is the part no bank line can carry: the same cash arriving can be
  // a profit or a loss depending on what the shares cost.
  const gain = b.gainLoss ?? 0;
  const outcome = gain >= 0 ? "gain" : "loss";
  const swept =
    b.cashSwept > 0.005
      ? `; ${money(b.cashSwept)} idle cash swept with it`
      : "";
  return (
    `${NOTE_PREFIX}Sold ${String(b.quantity)} ${b.symbol} at ${money(b.price ?? 0)} ` +
    `on ${b.soldDate ?? "?"}: ${money(b.proceeds ?? 0)} proceeds against ` +
    `${money(b.costBasis ?? 0)} basis, a ${money(Math.abs(gain))} ${outcome}${swept}`
  );
}

export function buildEnrichmentNote(
  enrichment: TransactionEnrichment,
): string | undefined {
  return (
    brokerageNote(enrichment) ??
    loanNote(enrichment) ??
    paystubNote(enrichment) ??
    vestNote(enrichment) ??
    itemsNote(enrichment) ??
    billNote(enrichment) ??
    insuranceNote(enrichment) ??
    billingPeriodsNote(enrichment) ??
    receiptNote(enrichment) ??
    venmoNote(enrichment)
  );
}

// What a note write would replace. Email-derived notes share the 🧾 namespace
// and are deliberately overwritten by vendor enrichment (a scraped item list
// beats a model's one-liner), but the count is surfaced so a run stays
// auditable.
export type PlannedNote = {
  transactionId: string;
  note: string;
  replacing: "none" | "pipeline" | "email";
};

const EMAIL_NOTE_MARKER = `${NOTE_PREFIX}Email: `;

// Monarch stores a note in NFKC, so what comes back is not always what was
// sent: "Ryzen™" returns as "RyzenTM" and a non-breaking hyphen as a plain
// one. Comparing the raw text finds a difference on every run and rewrites the
// same notes forever — 12 of them, silently, against the live API.
function sameNote(a: string, b: string): boolean {
  return a.normalize("NFKC") === b.normalize("NFKC");
}

export function planEnrichmentNotes(
  enriched: EnrichedTransaction[],
): PlannedNote[] {
  const planned: PlannedNote[] = [];
  for (const e of enriched) {
    if (e.enrichment === undefined) continue;
    const note = buildEnrichmentNote(e.enrichment);
    if (note === undefined) continue;

    const existing = e.transaction.notes;
    // A hand-written note is the owner's and is never touched.
    if (existing !== "" && !existing.startsWith(NOTE_PREFIX)) continue;
    if (sameNote(existing, note)) continue;

    planned.push({
      transactionId: e.transaction.id,
      note,
      replacing:
        existing === ""
          ? "none"
          : existing.startsWith(EMAIL_NOTE_MARKER)
            ? "email"
            : "pipeline",
    });
  }
  return planned;
}

// Writes purchase/bill breakdowns onto enriched transactions. Existing
// hand-written notes are never overwritten; notes we wrote before are
// refreshed in place.
export async function writeEnrichmentNotes(
  enriched: EnrichedTransaction[],
  dryRun = false,
): Promise<number> {
  const planned = planEnrichmentNotes(enriched);
  const replacingEmail = planned.filter((p) => p.replacing === "email").length;
  if (replacingEmail > 0) {
    log.info(
      `${String(replacingEmail)} of these replace email-derived notes with vendor enrichment`,
    );
  }
  if (dryRun) {
    log.info(`Would write notes on ${String(planned.length)} transactions`);
    return planned.length;
  }

  let written = 0;
  for (const note of planned) {
    await setTransactionNotes(note.transactionId, note.note);
    written++;
    if (written % 25 === 0) {
      log.progress(written, planned.length, "notes written");
    }
  }
  if (written > 0) {
    log.info(
      `Wrote purchase-breakdown notes on ${String(written)} transactions`,
    );
  }
  return written;
}
