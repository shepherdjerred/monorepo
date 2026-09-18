import { z } from "zod";
import type { Payslip } from "./types.ts";
import { PAYSLIPS_PATH, PAYROLL_DIR } from "../finance-vault.ts";
import { log } from "../logger.ts";

const PayslipLineSchema = z.object({
  label: z.string(),
  amount: z.number(),
});

const PayslipCacheSchema = z.object({
  version: z.literal(1),
  builtAt: z.string(),
  payslips: z.array(
    z.object({
      payDate: z.string(),
      periodStart: z.string(),
      periodEnd: z.string(),
      hours: z.number(),
      grossPay: z.number(),
      preTaxDeductions: z.number(),
      employeeTaxes: z.number(),
      postTaxDeductions: z.number(),
      netPay: z.number(),
      earnings: z.array(PayslipLineSchema),
      taxes: z.array(PayslipLineSchema),
      deductions: z.array(PayslipLineSchema),
      sourcePage: z.number(),
    }),
  ),
});

// Payslip PDFs are parsed by scripts/build-payslips.ts, mirroring the Costco
// pattern: slow document work happens out of band and the pipeline only loads
// structured data.
export async function loadPayslips(
  payslipsPath = PAYSLIPS_PATH,
): Promise<Payslip[]> {
  const file = Bun.file(payslipsPath);
  if (!(await file.exists())) {
    log.warn(
      `No payslips.json at ${payslipsPath}; run "bun run scripts/build-payslips.ts" after saving Workday payslip PDFs to ${PAYROLL_DIR}`,
    );
    return [];
  }
  const cache = PayslipCacheSchema.parse(JSON.parse(await file.text()));
  log.info(`Loaded ${String(cache.payslips.length)} payslips`);
  return cache.payslips;
}
