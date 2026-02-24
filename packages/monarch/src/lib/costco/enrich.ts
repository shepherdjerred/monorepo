import type { MonarchTransaction } from "../monarch/types.ts";
import type { TransactionEnrichment } from "../enrichment/types.ts";
import { loadCostcoOrders } from "./scraper.ts";
import { matchCostcoTransactions } from "./matcher.ts";
import { log } from "../logger.ts";

export type CostcoEnrichResult = {
  enrichments: Map<string, TransactionEnrichment>;
  matchRate: { matched: number; total: number };
};

export function enrichCostco(
  costcoTransactions: MonarchTransaction[],
): CostcoEnrichResult {
  const orders = loadCostcoOrders();
  log.info(`Loaded ${String(orders.length)} Costco orders`);

  const matchResult = matchCostcoTransactions(costcoTransactions, orders);
  log.info(
    `Matched ${String(matchResult.matched.length)}/${String(costcoTransactions.length)} Costco transactions`,
  );

  const enrichments = new Map<string, TransactionEnrichment>();

  for (const match of matchResult.matched) {
    enrichments.set(match.transaction.id, {
      items: match.order.items.map((item) => ({
        title: item.title,
        price: item.price,
      })),
      enrichmentSource: "costco",
    });
  }

  return {
    enrichments,
    matchRate: {
      matched: matchResult.matched.length,
      total: costcoTransactions.length,
    },
  };
}
