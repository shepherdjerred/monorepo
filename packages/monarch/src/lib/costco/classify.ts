import type { MonarchCategory, MonarchTransaction } from "../monarch/types.ts";
import type { ProposedChange, AmazonOrderInput, AmazonBatchOrderClassification } from "../classifier/types.ts";
import type { CostcoMatchResult } from "./matcher.ts";
import { loadCostcoOrders } from "./scraper.ts";
import { matchCostcoTransactions } from "./matcher.ts";
import { classifyAmazonBatch, computeSplits } from "../classifier/claude.ts";
import { getCachedClassification, cacheClassifications } from "../classifier/cache.ts";
import { log } from "../logger.ts";

// Reuse the shared helper from index.ts via inline logic
// (kept self-contained to avoid circular imports)
function applyClassification(
  transaction: MonarchTransaction,
  classification: AmazonBatchOrderClassification,
): ProposedChange {
  if (classification.needsSplit && classification.items.length > 1) {
    const splitItems = classification.items.map((item) => ({
      amount: item.price,
      categoryId: item.categoryId,
      itemName: item.title,
      categoryName: item.categoryName,
    }));

    const proratedSplits = computeSplits(transaction.amount, splitItems);

    return {
      transactionId: transaction.id,
      transactionDate: transaction.date,
      merchantName: transaction.merchant.name,
      amount: transaction.amount,
      currentCategory: transaction.category.name,
      currentCategoryId: transaction.category.id,
      proposedCategory: "SPLIT",
      proposedCategoryId: "",
      confidence: "high",
      type: "split",
      splits: proratedSplits.map((s) => ({
        itemName: s.itemName,
        amount: s.amount,
        categoryId: s.categoryId,
        categoryName: s.categoryName,
      })),
    };
  }

  const firstItem = classification.items[0];
  return {
    transactionId: transaction.id,
    transactionDate: transaction.date,
    merchantName: `Costco: ${firstItem?.title ?? "Unknown"}`,
    amount: transaction.amount,
    currentCategory: transaction.category.name,
    currentCategoryId: transaction.category.id,
    proposedCategory: firstItem?.categoryName ?? "Unknown",
    proposedCategoryId: firstItem?.categoryId ?? "",
    confidence: "high",
    type: "recategorize",
  };
}

export async function classifyCostco(
  categories: MonarchCategory[],
  costcoTransactions: MonarchTransaction[],
): Promise<{ changes: ProposedChange[]; matchResult: CostcoMatchResult }> {
  const orders = loadCostcoOrders();
  log.info(`Loaded ${String(orders.length)} Costco orders`);

  const matchResult = matchCostcoTransactions(costcoTransactions, orders);
  log.info(
    `Matched ${String(matchResult.matched.length)}/${String(costcoTransactions.length)} Costco transactions`,
  );

  const changes: ProposedChange[] = [];
  const uncached: { match: (typeof matchResult.matched)[number]; index: number }[] = [];

  for (let i = 0; i < matchResult.matched.length; i++) {
    const match = matchResult.matched[i];
    if (!match) continue;

    const cached = await getCachedClassification(match.order.orderId);
    if (cached) {
      changes.push(applyClassification(match.transaction, { orderIndex: i, ...cached }));
    } else {
      uncached.push({ match, index: i });
    }
  }

  if (uncached.length < matchResult.matched.length) {
    log.info(`${String(matchResult.matched.length - uncached.length)} orders from cache, ${String(uncached.length)} need classification`);
  }

  const batchSize = 20;
  for (let i = 0; i < uncached.length; i += batchSize) {
    const batch = uncached.slice(i, i + batchSize);
    log.progress(i + batch.length, uncached.length, "Costco orders classified");

    const orderInputs: AmazonOrderInput[] = batch.map((entry, idx) => ({
      orderIndex: idx,
      items: entry.match.order.items.map((item) => ({
        title: item.title,
        price: item.price,
      })),
    }));

    const result = await classifyAmazonBatch(categories, orderInputs);

    const toCache: { orderId: string; classification: AmazonBatchOrderClassification }[] = [];

    for (const classification of result.orders) {
      const entry = batch[classification.orderIndex];
      if (!entry) continue;

      changes.push(applyClassification(entry.match.transaction, classification));
      toCache.push({ orderId: entry.match.order.orderId, classification });
    }

    await cacheClassifications(toCache);
  }

  return { changes, matchResult };
}
