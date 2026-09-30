import type { Config } from "../config.ts";
import type { MonarchTransaction } from "../monarch/types.ts";
import type { TransactionEnrichment } from "../enrichment/types.ts";
import { parseVenmoCSV } from "./parser.ts";
import { allVenmoCsvs } from "../finance-vault.ts";
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
  // --venmo-csv names one file; otherwise every export in the vault is read.
  // Each covers a fixed date range, so the newest alone leaves a hole wherever
  // an earlier export was the only one reaching back that far.
  const paths =
    config.venmoCsv === undefined ? allVenmoCsvs() : [config.venmoCsv];
  if (paths.length === 0) {
    return { enrichments: new Map(), matchRate: { matched: 0, total: 0 } };
  }

  const byId = new Map<
    string,
    Awaited<ReturnType<typeof parseVenmoCSV>>[number]
  >();
  for (const csvPath of paths) {
    for (const txn of await parseVenmoCSV(csvPath)) byId.set(txn.id, txn);
  }
  const venmoTxns = [...byId.values()];
  log.info(
    `Parsed ${String(venmoTxns.length)} Venmo payments from ${String(paths.length)} export${paths.length === 1 ? "" : "s"}`,
  );

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
