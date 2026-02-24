import type { MonarchTransaction } from "../monarch/types.ts";
import type { TransactionEnrichment } from "../enrichment/types.ts";
import { loadConserviceFromPdfs } from "./parser.ts";
import { groupByMonth, matchBiltTransactions } from "./matcher.ts";
import { log } from "../logger.ts";

export type BiltEnrichResult = {
  enrichments: Map<string, TransactionEnrichment>;
  matchRate: { matched: number; total: number };
};

export async function enrichBilt(
  biltTransactions: MonarchTransaction[],
): Promise<BiltEnrichResult> {
  const charges = await loadConserviceFromPdfs();

  const months = groupByMonth(charges);
  log.info(`Grouped into ${String(months.length)} monthly summaries`);

  const matches = matchBiltTransactions(biltTransactions, months);
  log.info(
    `Matched ${String(matches.length)}/${String(biltTransactions.length)} Bilt transactions`,
  );

  const enrichments = new Map<string, TransactionEnrichment>();

  for (const match of matches) {
    const breakdown = match.splits.map((s) => ({
      serviceType: s.category,
      amount: s.amount,
    }));

    enrichments.set(match.monarchTransaction.id, {
      billBreakdown: breakdown,
      enrichmentSource: "bilt",
    });
  }

  return {
    enrichments,
    matchRate: {
      matched: matches.length,
      total: biltTransactions.length,
    },
  };
}
