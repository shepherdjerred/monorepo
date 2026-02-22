import type { MonarchCategory, MonarchTransaction } from "../monarch/types.ts";
import type { ProposedChange, ProposedSplit, AmazonBatchOrderClassification } from "../classifier/types.ts";
import type { MatchResult } from "./matcher.ts";
import { scrapeAmazonOrders } from "./scraper.ts";
import { matchAmazonOrders } from "./matcher.ts";
import { classifyAmazonBatch, computeSplits } from "../classifier/claude.ts";
import { getCachedClassification, cacheClassifications } from "../classifier/cache.ts";
import { log } from "../logger.ts";

export function applyClassification(
  match: { transaction: MonarchTransaction; order: { orderId: string } },
  classification: AmazonBatchOrderClassification,
  merchantPrefix: string,
): ProposedChange {
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

    return {
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
    };
  }

  const firstItem = classification.items[0];
  return {
    transactionId: match.transaction.id,
    transactionDate: match.transaction.date,
    merchantName: `${merchantPrefix}: ${firstItem?.title ?? "Unknown"}`,
    amount: match.transaction.amount,
    currentCategory: match.transaction.category.name,
    currentCategoryId: match.transaction.category.id,
    proposedCategory: firstItem?.categoryName ?? "Unknown",
    proposedCategoryId: firstItem?.categoryId ?? "",
    confidence: "high",
    type: "recategorize",
  };
}

export async function classifyAmazon(
  amazonYears: number[],
  forceScrape: boolean,
  categories: MonarchCategory[],
  amazonTransactions: MonarchTransaction[],
): Promise<{ changes: ProposedChange[]; matchResult: MatchResult }> {
  const orders = await scrapeAmazonOrders(amazonYears, forceScrape);
  log.info(`Scraped ${String(orders.length)} Amazon orders`);

  const matchResult = matchAmazonOrders(amazonTransactions, orders);
  log.info(
    `Matched ${String(matchResult.matched.length)}/${String(amazonTransactions.length)} transactions`,
  );

  const changes: ProposedChange[] = [];
  const uncached: { match: (typeof matchResult.matched)[number]; index: number }[] = [];

  for (let i = 0; i < matchResult.matched.length; i++) {
    const match = matchResult.matched[i];
    if (!match) continue;

    const cached = await getCachedClassification(match.order.orderId);
    if (cached) {
      changes.push(applyClassification(match, { orderIndex: i, ...cached }, "Amazon"));
    } else {
      uncached.push({ match, index: i });
    }
  }

  if (uncached.length < matchResult.matched.length) {
    log.info(`${String(matchResult.matched.length - uncached.length)} orders from cache, ${String(uncached.length)} need classification`);
  }

  const batchSize = 20;
  const concurrency = 3;
  const batches: (typeof uncached)[] = [];
  for (let i = 0; i < uncached.length; i += batchSize) {
    batches.push(uncached.slice(i, i + batchSize));
  }

  let completed = 0;
  for (let i = 0; i < batches.length; i += concurrency) {
    const chunk = batches.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map(async (batch) => {
        const orderInputs = batch.map((entry, idx) => ({
          orderIndex: idx,
          items: entry.match.order.items.map((item) => ({
            title: item.title,
            price: item.price,
          })),
        }));
        return { batch, result: await classifyAmazonBatch(categories, orderInputs) };
      }),
    );

    const toCache: { orderId: string; classification: AmazonBatchOrderClassification }[] = [];
    for (const { batch, result } of results) {
      for (const classification of result.orders) {
        const entry = batch[classification.orderIndex];
        if (!entry) continue;
        changes.push(applyClassification(entry.match, classification, "Amazon"));
        toCache.push({ orderId: entry.match.order.orderId, classification });
      }
      completed += batch.length;
    }
    log.progress(completed, uncached.length, "Amazon orders classified");
    await cacheClassifications(toCache);
  }

  return { changes, matchResult };
}
