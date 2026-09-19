import path from "node:path";
import { Glob } from "bun";
import type { LoanSplit, LoanGap } from "./types.ts";
import { loadLoanMail } from "./parser.ts";
import { deriveLoanSchedule } from "./schedule.ts";
import { parseEdfinancialCsv } from "./edfinancial.ts";
import { parseAudiStatement } from "./audi.ts";
import { readPdfPages } from "../pdf/extract.ts";
import { AUDI_DIR, EDFINANCIAL_DIR, allVaultFiles } from "../finance-vault.ts";
import { log } from "../logger.ts";

// Every servicer this path can read, in one place. They divide into two kinds:
// Upstart states only a running balance, so its splits are reconstructed by
// differencing consecutive statements; Audi and Edfinancial print principal
// and interest per payment, so theirs are read. The loan path treats both the
// same afterwards, which is why `origin` travels with the split.

export type LoanSources = {
  splits: LoanSplit[];
  gaps: LoanGap[];
};

async function loadAudiSplits(): Promise<LoanSplit[]> {
  const files = [...new Glob("*.pdf").scanSync(AUDI_DIR)].sort();
  const splits: LoanSplit[] = [];
  for (const file of files) {
    const full = path.join(AUDI_DIR, file);
    const pages = await readPdfPages(full);
    const split = parseAudiStatement(
      pages.flatMap((page) => page.lines),
      file,
    );
    // A statement issued before the first payment records none. That is a
    // normal statement, not a parse failure.
    if (split !== undefined) splits.push(split);
  }
  if (files.length > 0 && splits.length === 0) {
    throw new Error(
      `${String(files.length)} Audi statements in ${AUDI_DIR} but no payment was read from any of them; the statement layout has changed`,
    );
  }
  return splits;
}

async function loadEdfinancialSplits(): Promise<LoanSplit[]> {
  const files = allVaultFiles(EDFINANCIAL_DIR, "*.csv");
  const texts = await Promise.all(files.map((f) => Bun.file(f).text()));
  return texts.flatMap((text) => parseEdfinancialCsv(text));
}

// A split is identified by the payment it describes. The same payment can
// appear in two overlapping exports, and applying it twice would propose two
// competing splits for one transaction.
function dedupe(splits: LoanSplit[]): LoanSplit[] {
  const seen = new Map<string, LoanSplit>();
  for (const split of splits) {
    seen.set(`${split.loanId}|${split.date}|${split.amount.toFixed(2)}`, split);
  }
  return [...seen.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function loadLoanSplits(): Promise<LoanSources> {
  const { balances, payments } = await loadLoanMail();
  const derived = deriveLoanSchedule(balances, payments);

  const [audi, edfinancial] = await Promise.all([
    loadAudiSplits(),
    loadEdfinancialSplits(),
  ]);

  const stated = audi.length + edfinancial.length;
  log.info(
    `Loan sources: ${String(derived.splits.length)} splits derived from servicer mail, ${String(stated)} stated on statements (${String(audi.length)} Audi, ${String(edfinancial.length)} Edfinancial)`,
  );

  return {
    splits: dedupe([...derived.splits, ...audi, ...edfinancial]),
    gaps: derived.gaps,
  };
}
