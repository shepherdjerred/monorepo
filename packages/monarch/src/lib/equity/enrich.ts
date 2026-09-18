import type { MonarchTransaction } from "../monarch/types.ts";
import type { TransactionEnrichment } from "../enrichment/types.ts";
import { latestEquityCsv, EQUITY_DIR } from "../finance-vault.ts";
import { parseEquityAwardsCsv } from "./parser.ts";
import { matchVestEvents, vestTotals } from "./matcher.ts";
import { log } from "../logger.ts";

export type EquityEnrichResult = {
  enrichments: Map<string, TransactionEnrichment>;
  matchRate: { matched: number; total: number };
};

export async function enrichEquity(
  equityTransactions: MonarchTransaction[],
): Promise<EquityEnrichResult> {
  const csvPath = latestEquityCsv();
  if (csvPath === undefined) {
    throw new Error(
      `No Equity Award Center export in ${EQUITY_DIR}. Download it from Schwab (Equity Awards > Transactions > Export) and save it there.`,
    );
  }

  const events = parseEquityAwardsCsv(await Bun.file(csvPath).text());
  const result = matchVestEvents(equityTransactions, events);
  const matchedRows = result.matched.reduce(
    (sum, m) => sum + m.transactions.length,
    0,
  );
  log.info(
    `Matched ${String(matchedRows)}/${String(equityTransactions.length)} equity rows to ${String(result.matched.length)} vest events`,
  );

  for (const mismatch of result.countMismatches) {
    log.warn(
      `  ${mismatch.event.vestDate}: ${String(mismatch.transactions.length)} Monarch rows but ${String(mismatch.event.awards.length)} awards released`,
    );
  }
  if (result.unmatchedEvents.length > 0) {
    log.info(
      `${String(result.unmatchedEvents.length)} vest events have no Monarch row (${result.unmatchedEvents.map((e) => e.vestDate).join(", ")})`,
    );
  }

  const enrichments = new Map<string, TransactionEnrichment>();
  for (const match of result.matched) {
    const totals = vestTotals(match.event);
    // Derived from the totals rather than read off the first award. Every
    // award in one lapse has settled at the same price so far, and this
    // returns exactly that price when they do — without depending on it.
    const fairMarketValue =
      totals.shares === 0 ? 0 : totals.grossValue / totals.shares;
    for (const transaction of match.transactions) {
      enrichments.set(transaction.id, {
        vest: {
          vestDate: match.event.vestDate,
          symbol: match.event.symbol,
          awardCount: match.event.awards.length,
          shares: totals.shares,
          fairMarketValue,
          grossValue: totals.grossValue,
          sharesWithheld: totals.sharesWithheld,
          netShares: totals.netShares,
          taxes: totals.taxes,
        },
        enrichmentSource: "equity",
      });
    }
  }

  return {
    enrichments,
    matchRate: { matched: matchedRows, total: equityTransactions.length },
  };
}
