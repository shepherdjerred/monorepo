import type { MonarchTransaction } from "../monarch/types.ts";
import type { TransactionEnrichment } from "../enrichment/types.ts";
import { matchUsaaTransactions, buildUsaaSplits } from "./matcher.ts";
import { loadUsaaStatements } from "./parser.ts";
import { log } from "../logger.ts";

export type UsaaEnrichResult = {
  enrichments: Map<string, TransactionEnrichment>;
  matchRate: { matched: number; total: number };
};

export async function enrichUsaa(
  usaaTransactions: MonarchTransaction[],
): Promise<UsaaEnrichResult> {
  const statements = await loadUsaaStatements();
  const { matched, unmatchedTransactions } = matchUsaaTransactions(
    usaaTransactions,
    statements,
  );
  log.info(
    `Matched ${String(matched.length)}/${String(usaaTransactions.length)} USAA transactions`,
  );

  if (unmatchedTransactions.length > 0) {
    log.info(
      `Unmatched USAA transactions: ${String(unmatchedTransactions.length)}`,
    );
  }

  const enrichments = new Map<string, TransactionEnrichment>();

  for (const match of matched) {
    const splits = buildUsaaSplits(match.statement);
    const lines = splits.map((s, i) => ({
      policyType: i === 0 ? "Auto Insurance" : "Renters Insurance",
      amount: s.amount,
    }));

    enrichments.set(match.monarchTransactionId, {
      insuranceLines: lines,
      enrichmentSource: "usaa",
    });
  }

  return {
    enrichments,
    matchRate: {
      matched: matched.length,
      total: usaaTransactions.length,
    },
  };
}
