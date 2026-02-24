import type { MonarchTransaction } from "../monarch/types.ts";
import type { TransactionEnrichment } from "../enrichment/types.ts";
import { scrapeAmazonOrders } from "./scraper.ts";
import { matchAmazonOrders } from "./matcher.ts";
import { log } from "../logger.ts";

export type AmazonEnrichResult = {
  enrichments: Map<string, TransactionEnrichment>;
  matchRate: { matched: number; total: number };
};

export async function enrichAmazon(
  amazonYears: number[],
  forceScrape: boolean,
  amazonTransactions: MonarchTransaction[],
): Promise<AmazonEnrichResult> {
  const orders = await scrapeAmazonOrders(amazonYears, forceScrape);
  log.info(`Scraped ${String(orders.length)} Amazon orders`);

  const matchResult = matchAmazonOrders(amazonTransactions, orders);
  log.info(
    `Matched ${String(matchResult.matched.length)}/${String(amazonTransactions.length)} Amazon transactions`,
  );

  const enrichments = new Map<string, TransactionEnrichment>();

  for (const match of matchResult.matched) {
    enrichments.set(match.transaction.id, {
      items: match.order.items.map((item) => ({
        title: item.title,
        price: item.price,
      })),
      enrichmentSource: "amazon",
    });
  }

  return {
    enrichments,
    matchRate: {
      matched: matchResult.matched.length,
      total: amazonTransactions.length,
    },
  };
}
