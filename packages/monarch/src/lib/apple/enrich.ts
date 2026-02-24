import type { MonarchTransaction } from "../monarch/types.ts";
import type { TransactionEnrichment } from "../enrichment/types.ts";
import { loadAppleReceipts } from "./parser.ts";
import { matchAppleTransactions } from "./matcher.ts";
import { log } from "../logger.ts";

export type AppleEnrichResult = {
  enrichments: Map<string, TransactionEnrichment>;
  matchRate: { matched: number; total: number };
};

export async function enrichApple(
  appleMailDir: string,
  appleTransactions: MonarchTransaction[],
): Promise<AppleEnrichResult> {
  const receipts = await loadAppleReceipts(appleMailDir);
  const matchResult = matchAppleTransactions(appleTransactions, receipts);
  log.info(
    `Matched ${String(matchResult.matched.length)}/${String(appleTransactions.length)} Apple transactions`,
  );

  const enrichments = new Map<string, TransactionEnrichment>();

  for (const match of matchResult.matched) {
    if (match.receipt.items.length === 0) continue;

    enrichments.set(match.transaction.id, {
      receiptItems: match.receipt.items.map((item) => ({
        title: item.title,
        price: item.price,
        isSubscription: item.isSubscription,
      })),
      enrichmentSource: "apple",
    });
  }

  return {
    enrichments,
    matchRate: {
      matched: matchResult.matched.length,
      total: appleTransactions.length,
    },
  };
}
