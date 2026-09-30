import type { MonarchTransaction } from "../monarch/types.ts";
import type { TransactionEnrichment } from "../enrichment/types.ts";
import { loadPayslips } from "./parser.ts";
import { matchPayslips, grossChangePercent } from "./matcher.ts";
import { log } from "../logger.ts";

export type PaystubEnrichResult = {
  enrichments: Map<string, TransactionEnrichment>;
  matchRate: { matched: number; total: number };
};

export async function enrichPaystub(
  paystubTransactions: MonarchTransaction[],
): Promise<PaystubEnrichResult> {
  const payslips = await loadPayslips();
  const result = matchPayslips(paystubTransactions, payslips);
  log.info(
    `Matched ${String(result.matched.length)}/${String(paystubTransactions.length)} payroll deposits to payslips`,
  );

  if (result.amountMismatches.length > 0) {
    log.warn(
      `${String(result.amountMismatches.length)} deposits differ from the payslip's net pay:`,
    );
    for (const mismatch of result.amountMismatches) {
      log.warn(
        `  ${mismatch.transaction.date}: deposit ${mismatch.transaction.amount.toFixed(2)} vs net ${mismatch.payslip.netPay.toFixed(2)} (payslip ${mismatch.payslip.payDate})`,
      );
    }
  }
  if (result.unmatchedPayslips.length > 0) {
    log.info(
      `${String(result.unmatchedPayslips.length)} payslips have no matching deposit (pay dates: ${result.unmatchedPayslips
        .map((p) => p.payDate)
        .join(", ")})`,
    );
  }

  // Regular payroll only, for the same reason matchPayslips uses it: a
  // supplemental equity release nets to zero and its gross is the whole share
  // value, so comparing an $8,000 paycheck against a $51,000 equity slip
  // reports a spurious -84% change. Sorted by pay date, then by page so two
  // slips on one date still order deterministically.
  const priorSeries = payslips
    .filter((p) => p.netPay > 0)
    .sort(
      (a, b) =>
        a.payDate.localeCompare(b.payDate) || a.sourcePage - b.sourcePage,
    );
  const enrichments = new Map<string, TransactionEnrichment>();
  for (const match of result.matched) {
    const index = priorSeries.indexOf(match.payslip);
    const change = grossChangePercent(
      match.payslip,
      // index 0 reads past the start and yields undefined: the first payslip
      // has no prior period to compare against.
      priorSeries[index - 1],
    );
    enrichments.set(match.transaction.id, {
      payslip: {
        periodStart: match.payslip.periodStart,
        periodEnd: match.payslip.periodEnd,
        grossPay: match.payslip.grossPay,
        netPay: match.payslip.netPay,
        employeeTaxes: match.payslip.employeeTaxes,
        preTaxDeductions: match.payslip.preTaxDeductions,
        earnings: match.payslip.earnings,
        taxes: match.payslip.taxes,
        deductions: match.payslip.deductions,
        grossChangePercent: change,
      },
      enrichmentSource: "paystub",
    });
  }

  return {
    enrichments,
    matchRate: {
      matched: result.matched.length,
      total: paystubTransactions.length,
    },
  };
}
