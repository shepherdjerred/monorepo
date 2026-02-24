import type { Config } from "../config.ts";
import type { MonarchTransaction } from "../monarch/types.ts";
import type { TransactionEnrichment } from "../enrichment/types.ts";
import { parseVenmoCSV } from "./parser.ts";
import { matchVenmoTransactions } from "./matcher.ts";
import { log } from "../logger.ts";

export type VenmoEnrichResult = {
  enrichments: Map<string, TransactionEnrichment>;
  matchRate: { matched: number; total: number };
};

export async function enrichVenmo(
  config: Config,
  venmoTransactions: MonarchTransaction[],
): Promise<VenmoEnrichResult> {
  if (config.venmoCsv === undefined) {
    return { enrichments: new Map(), matchRate: { matched: 0, total: 0 } };
  }

  const venmoTxns = await parseVenmoCSV(config.venmoCsv);
  log.info(`Parsed ${String(venmoTxns.length)} Venmo payments`);

  const matchResult = matchVenmoTransactions(venmoTransactions, venmoTxns);
  log.info(
    `Matched ${String(matchResult.matched.length)}/${String(venmoTransactions.length)} Venmo transactions`,
  );

  const enrichments = new Map<string, TransactionEnrichment>();

  for (const match of matchResult.matched) {
    const direction: "sent" | "received" =
      match.venmoTransaction.amount > 0 ? "received" : "sent";
    const counterparty =
      match.venmoTransaction.amount > 0
        ? match.venmoTransaction.from
        : match.venmoTransaction.to;

    enrichments.set(match.transaction.id, {
      paymentNote: match.venmoTransaction.note,
      paymentDirection: direction,
      paymentCounterparty: counterparty,
      enrichmentSource: "venmo",
    });
  }

  return {
    enrichments,
    matchRate: {
      matched: matchResult.matched.length,
      total: venmoTransactions.length,
    },
  };
}
