import type { MonarchTransaction } from "../monarch/types.ts";
import type { TransactionEnrichment } from "../enrichment/types.ts";
import { parseSclCSV } from "./parser.ts";
import { matchSclTransactions } from "./matcher.ts";
import { log } from "../logger.ts";

export type SclEnrichResult = {
  enrichments: Map<string, TransactionEnrichment>;
  matchRate: { matched: number; total: number };
};

export async function enrichScl(
  sclCsvPath: string,
  sclTransactions: MonarchTransaction[],
): Promise<SclEnrichResult> {
  const text = await Bun.file(sclCsvPath).text();
  const bills = parseSclCSV(text);

  const { matched } = matchSclTransactions(sclTransactions, bills);
  log.info(
    `Matched ${String(matched.length)}/${String(sclTransactions.length)} Seattle City Light transactions`,
  );

  const enrichments = new Map<string, TransactionEnrichment>();

  for (const match of matched) {
    const txn = match.transaction;
    const halfAmount = Math.round((Math.abs(txn.amount) * 100) / 2) / 100;
    const remainder = Math.round(Math.abs(txn.amount) * 100) / 100 - halfAmount;

    enrichments.set(txn.id, {
      billingPeriods: [
        { period: "current month", amount: halfAmount },
        { period: "prior month", amount: remainder },
      ],
      enrichmentSource: "scl",
    });
  }

  return {
    enrichments,
    matchRate: {
      matched: matched.length,
      total: sclTransactions.length,
    },
  };
}
