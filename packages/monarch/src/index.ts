#!/usr/bin/env bun
import { getConfig } from "./lib/config.ts";
import type { Config } from "./lib/config.ts";
import {
  initMonarch,
  fetchAllTransactions,
  fetchCategories,
  groupByMerchant,
  applyCategory,
  flagForReview,
  applySplits,
} from "./lib/monarch/client.ts";
import type { MonarchCategory, MonarchTransaction, MerchantGroup } from "./lib/monarch/types.ts";
import {
  initClaude,
  classifyMerchantBatch,
  classifyAmazonItems,
  computeSplits,
} from "./lib/classifier/claude.ts";
import { scrapeAmazonOrders } from "./lib/amazon/scraper.ts";
import { matchAmazonOrders } from "./lib/amazon/matcher.ts";
import type { MatchResult } from "./lib/amazon/matcher.ts";
import type { ProposedChange, ProposedSplit } from "./lib/classifier/types.ts";
import {
  displayMerchantChanges,
  displayAmazonChanges,
  displaySummary,
} from "./lib/display.ts";

function getDateRange(): { startDate: string; endDate: string } {
  const endDate = new Date().toISOString().split("T")[0] ?? "";
  const startDate =
    new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0] ?? "";
  return { startDate, endDate };
}

async function classifyMerchants(
  categories: MonarchCategory[],
  merchantGroups: MerchantGroup[],
  batchSize: number,
): Promise<ProposedChange[]> {
  const changes: ProposedChange[] = [];

  for (let i = 0; i < merchantGroups.length; i += batchSize) {
    const batch = merchantGroups.slice(i, i + batchSize);
    console.error(
      `Classifying merchants ${String(i + 1)}-${String(i + batch.length)} of ${String(merchantGroups.length)}...`,
    );

    const result = await classifyMerchantBatch(categories, batch);

    for (const classification of result.merchants) {
      const group = batch.find(
        (m) => m.merchantName === classification.merchantName,
      );
      if (!group) continue;

      if (classification.ambiguous) {
        for (const txn of group.transactions) {
          changes.push({
            transactionId: txn.id,
            transactionDate: txn.date,
            merchantName: group.merchantName,
            amount: txn.amount,
            currentCategory: group.currentCategory,
            currentCategoryId: group.currentCategoryId,
            proposedCategory: classification.categoryName,
            proposedCategoryId: classification.categoryId,
            confidence: classification.confidence,
            type: "flag",
            reason: classification.reason,
          });
        }
        continue;
      }

      if (classification.categoryId === group.currentCategoryId) continue;

      for (const txn of group.transactions) {
        changes.push({
          transactionId: txn.id,
          transactionDate: txn.date,
          merchantName: group.merchantName,
          amount: txn.amount,
          currentCategory: group.currentCategory,
          currentCategoryId: group.currentCategoryId,
          proposedCategory: classification.categoryName,
          proposedCategoryId: classification.categoryId,
          confidence: classification.confidence,
          type: "recategorize",
        });
      }
    }
  }

  return changes;
}

async function classifyAmazon(
  config: Config,
  categories: MonarchCategory[],
  amazonTransactions: MonarchTransaction[],
): Promise<{ changes: ProposedChange[]; matchResult: MatchResult }> {
  const orders = await scrapeAmazonOrders(
    config.amazonYears,
    config.forceScrape,
  );
  console.error(`Scraped ${String(orders.length)} Amazon orders`);

  const matchResult = matchAmazonOrders(amazonTransactions, orders);
  console.error(
    `Matched ${String(matchResult.matched.length)}/${String(amazonTransactions.length)} transactions`,
  );

  const changes: ProposedChange[] = [];

  for (const match of matchResult.matched) {
    const items = match.order.items.map((item) => ({
      title: item.title,
      price: item.price,
    }));

    const classification = await classifyAmazonItems(categories, items);

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
        merchantName: `Amazon: ${firstItem.title}`,
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

  return { changes, matchResult };
}

async function applyChanges(changes: ProposedChange[]): Promise<void> {
  console.error("\nApplying changes...");
  let applied = 0;

  for (const change of changes) {
    if (change.type === "recategorize") {
      console.error(
        `  Updating ${change.merchantName} → ${change.proposedCategory}`,
      );
      await applyCategory(change.transactionId, change.proposedCategoryId);
      applied++;
    } else if (change.type === "flag") {
      console.error(`  Flagging ${change.merchantName} for review`);
      await flagForReview(change.transactionId);
      applied++;
    } else if (change.splits !== undefined) {
      console.error(`  Splitting ${change.merchantName}`);
      await applySplits(
        change.transactionId,
        change.splits.map((s) => ({
          amount: s.amount,
          categoryId: s.categoryId,
          merchantName: s.itemName,
        })),
      );
      applied++;
    }
  }

  console.error(`\nDone! Applied ${String(applied)} changes.`);
}

async function main(): Promise<void> {
  const config = getConfig();

  initMonarch(config.monarchToken);
  initClaude(config.anthropicApiKey, config.model);

  const { startDate, endDate } = getDateRange();
  console.error(`Fetching transactions from ${startDate} to ${endDate}...`);

  const [categories, allTransactions] = await Promise.all([
    fetchCategories(),
    fetchAllTransactions(startDate, endDate),
  ]);

  console.error(
    `Found ${String(allTransactions.length)} transactions, ${String(categories.length)} categories`,
  );

  let transactions = allTransactions;
  if (config.limit > 0) {
    transactions = transactions.slice(0, config.limit);
    console.error(`Limited to ${String(transactions.length)} transactions`);
  }

  const { amazonTransactions, merchantGroups } =
    groupByMerchant(transactions);
  console.error(
    `${String(merchantGroups.length)} merchants, ${String(amazonTransactions.length)} Amazon transactions`,
  );

  const merchantChanges = await classifyMerchants(
    categories,
    merchantGroups,
    config.batchSize,
  );
  displayMerchantChanges(merchantChanges);

  let amazonChanges: ProposedChange[] = [];
  let matchResult: MatchResult | null = null;

  if (!config.skipAmazon && amazonTransactions.length > 0) {
    console.error("\n--- Amazon Deep Classification ---");
    const result = await classifyAmazon(
      config,
      categories,
      amazonTransactions,
    );
    amazonChanges = result.changes;
    matchResult = result.matchResult;
    displayAmazonChanges(amazonChanges, matchResult);
  }

  displaySummary(merchantChanges, amazonChanges, matchResult);

  if (config.apply) {
    await applyChanges([...merchantChanges, ...amazonChanges]);
  } else {
    console.error(
      "\nDry run complete. Use --apply to apply these changes.",
    );
  }
}

try {
  await main();
} catch (error: unknown) {
  console.error("Fatal error:", error);
  process.exit(1);
}
