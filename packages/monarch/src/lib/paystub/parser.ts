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
  // Payroll deposits reached this path because they were selected for it, and
  // the promise of the path is that they get real payslip evidence. Returning
  // nothing would let them be classified and reported as a successful run
  // without it; --skip-paystub is the way to opt out on purpose.
  if (!(await file.exists())) {
    throw new Error(
      `No payslips.json at ${payslipsPath}; run "bun run scripts/build-payslips.ts" after saving Workday payslip PDFs to ${PAYROLL_DIR}, or pass --skip-paystub`,
    );
  }
  const cache = PayslipCacheSchema.parse(JSON.parse(await file.text()));
  log.info(`Loaded ${String(cache.payslips.length)} payslips`);
  return cache.payslips;
}
