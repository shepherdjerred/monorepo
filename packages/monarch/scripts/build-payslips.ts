// Parse Workday payslip PDFs from the finance vault into payslips.json.
//
//   bun run scripts/build-payslips.ts [--dry-run]
//
// Mirrors scripts/build-costco-orders.ts: the slow document parsing happens
// here and writes a small JSON next to the source documents, so the pipeline
// only ever loads structured data.
//
// Workday's "Payslip to Print" export is a bundle with one payslip per page,
// so pages are parsed individually and dates come from inside the document
// rather than from filenames.
import path from "node:path";
import { Glob } from "bun";
import { readPdfPages } from "../src/lib/pdf/extract.ts";
import {
  parsePayslipPage,
  payslipColumns,
  isPayslipPage,
} from "../src/lib/paystub/parse-payslip.ts";
import type { Payslip, PayslipCache } from "../src/lib/paystub/types.ts";
import { PAYROLL_DIR, PAYSLIPS_PATH } from "../src/lib/finance-vault.ts";
import { log } from "../src/lib/logger.ts";

const DRY_RUN = process.argv.includes("--dry-run");

const pdfPaths: string[] = [];
for (const file of new Glob("*.pdf").scanSync(PAYROLL_DIR)) {
  pdfPaths.push(path.join(PAYROLL_DIR, file));
}
if (pdfPaths.length === 0) {
  throw new Error(
    `No payslip PDFs in ${PAYROLL_DIR}. Export them from Workday (Pay > Payslips > Print) and save them there.`,
  );
}
pdfPaths.sort();

const payslips: Payslip[] = [];
const failures: string[] = [];

for (const pdfPath of pdfPaths) {
  const name = path.basename(pdfPath);
  const pages = await readPdfPages(pdfPath);
  log.info(`${name}: ${String(pages.length)} pages`);

  let recognized = 0;
  for (const page of pages) {
    if (!isPayslipPage(page.lines)) continue;
    recognized++;
    try {
      payslips.push(parsePayslipPage(payslipColumns(page.lines), page.page));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${name} p${String(page.page)}: ${message}`);
    }
  }
  // A payslip PDF with no recognized page means Workday moved the marker this
  // script keys on, not that the file is empty. Left unreported it would write
  // an empty cache over a good one and silently drop all payroll enrichment.
  if (recognized === 0) {
    failures.push(`${name}: no page was recognized as a payslip`);
  }
}

payslips.sort((a, b) => a.payDate.localeCompare(b.payDate));

console.log(`\nParsed ${String(payslips.length)} payslips`);
if (payslips.length > 0) {
  console.log(
    `  range: ${payslips[0]?.payDate ?? "?"} .. ${payslips[payslips.length - 1]?.payDate ?? "?"}`,
  );
  const gross = payslips.reduce((sum, p) => sum + p.grossPay, 0);
  const net = payslips.reduce((sum, p) => sum + p.netPay, 0);
  console.log(
    `  gross total $${gross.toFixed(2)} -> net total $${net.toFixed(2)}`,
  );
}
if (failures.length > 0) {
  console.log(`\n${String(failures.length)} parser failures:`);
  for (const failure of failures) console.log(`  ${failure}`);
  throw new Error(
    `${String(failures.length)} payslip pages failed to parse or were not recognized; fix the parser rather than shipping partial payroll data`,
  );
}

if (DRY_RUN) {
  console.log("\nDry run: payslips.json not written.");
  process.exit(0);
}

const cache: PayslipCache = {
  version: 1,
  builtAt: new Date().toISOString(),
  payslips,
};
await Bun.write(PAYSLIPS_PATH, `${JSON.stringify(cache, null, 2)}\n`);
console.log(`\nWrote ${String(payslips.length)} payslips to ${PAYSLIPS_PATH}`);
