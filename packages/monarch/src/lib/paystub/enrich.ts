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

  const byPayDate = [...payslips].sort((a, b) =>
    a.payDate.localeCompare(b.payDate),
  );
  const enrichments = new Map<string, TransactionEnrichment>();
  for (const match of result.matched) {
    const index = byPayDate.findIndex(
      (p) => p.payDate === match.payslip.payDate,
    );
    const change = grossChangePercent(
      match.payslip,
      // index 0 reads past the start and yields undefined: the first payslip
      // has no prior period to compare against.
      byPayDate[index - 1],
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
