import type { MonarchCategory, MonarchTransaction } from "../monarch/types.ts";
import type { ProposedChange, ProposedSplit } from "../classifier/types.ts";
import type { CostcoMatchResult } from "./matcher.ts";
import type { AmazonOrderInput } from "../classifier/types.ts";
import { scrapeCostcoOrders } from "./scraper.ts";
import { matchCostcoTransactions } from "./matcher.ts";
import { classifyAmazonBatch, computeSplits } from "../classifier/claude.ts";
import { log } from "../logger.ts";

export async function classifyCostco(
  categories: MonarchCategory[],
  costcoTransactions: MonarchTransaction[],
  forceScrape: boolean,
): Promise<{ changes: ProposedChange[]; matchResult: CostcoMatchResult }> {
  const orders = await scrapeCostcoOrders(forceScrape);
  log.info(`Scraped ${String(orders.length)} Costco orders`);

  const matchResult = matchCostcoTransactions(costcoTransactions, orders);
  log.info(
    `Matched ${String(matchResult.matched.length)}/${String(costcoTransactions.length)} Costco transactions`,
  );

  const changes: ProposedChange[] = [];
  const batchSize = 20;

  for (let i = 0; i < matchResult.matched.length; i += batchSize) {
    const batch = matchResult.matched.slice(i, i + batchSize);
    log.progress(i + batch.length, matchResult.matched.length, "Costco orders classified");

    const orderInputs: AmazonOrderInput[] = batch.map((match, idx) => ({
      orderIndex: idx,
      items: match.order.items.map((item) => ({
        title: item.title,
        price: item.price,
      })),
    }));

    const result = await classifyAmazonBatch(categories, orderInputs);

    for (const classification of result.orders) {
      const match = batch[classification.orderIndex];
      if (!match) continue;

      if (classification.needsSplit && classification.items.length > 1) {
        const splitItems = classification.items.map((item) => ({
          amount: item.price,
          categoryId: item.categoryId,
          itemName: item.title,
          categoryName: item.categoryName,
        }));

        const proratedSplits = computeSplits(
          match.transaction.amount,
          splitItems,
        );

        const splits: ProposedSplit[] = proratedSplits.map((s) => ({
          itemName: s.itemName,
          amount: s.amount,
          categoryId: s.categoryId,
          categoryName: s.categoryName,
        }));

        changes.push({
          transactionId: match.transaction.id,
          transactionDate: match.transaction.date,
          merchantName: match.transaction.merchant.name,
          amount: match.transaction.amount,
          currentCategory: match.transaction.category.name,
          currentCategoryId: match.transaction.category.id,
          proposedCategory: "SPLIT",
          proposedCategoryId: "",
          confidence: "high",
          type: "split",
          splits,
        });
      } else {
        const firstItem = classification.items[0];
        if (!firstItem) continue;

        changes.push({
          transactionId: match.transaction.id,
          transactionDate: match.transaction.date,
          merchantName: `Costco: ${firstItem.title}`,
          amount: match.transaction.amount,
          currentCategory: match.transaction.category.name,
          currentCategoryId: match.transaction.category.id,
          proposedCategory: firstItem.categoryName,
          proposedCategoryId: firstItem.categoryId,
          confidence: "high",
          type: "recategorize",
        });
      }
    }
  }

  return { changes, matchResult };
}
