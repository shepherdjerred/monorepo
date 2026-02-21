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
  getUsageSummary,
} from "./lib/classifier/claude.ts";
import { scrapeAmazonOrders } from "./lib/amazon/scraper.ts";
import { matchAmazonOrders } from "./lib/amazon/matcher.ts";
import type { MatchResult } from "./lib/amazon/matcher.ts";
import type { ProposedChange, ProposedSplit } from "./lib/classifier/types.ts";
import {
  displayMerchantChanges,
  displayUnchangedMerchants,
  displayAmazonChanges,
  displaySummary,
  displaySingleChange,
  displayUsageSummary,
} from "./lib/display.ts";
import { log, setLogLevel } from "./lib/logger.ts";
import { setUserHints } from "./lib/classifier/prompt.ts";
import path from "node:path";

function getDateRange(): { startDate: string; endDate: string } {
  const endDate = new Date().toISOString().split("T")[0] ?? "";
  const startDate =
    new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0] ?? "";
  return { startDate, endDate };
}

import type { UnchangedMerchant } from "./lib/display.ts";

type MerchantClassifyResult = {
  changes: ProposedChange[];
  unchanged: UnchangedMerchant[];
};

async function classifyMerchants(
  categories: MonarchCategory[],
  merchantGroups: MerchantGroup[],
  batchSize: number,
): Promise<MerchantClassifyResult> {
  const changes: ProposedChange[] = [];
  const unchanged: UnchangedMerchant[] = [];

  for (let i = 0; i < merchantGroups.length; i += batchSize) {
    const batch = merchantGroups.slice(i, i + batchSize);
    log.progress(
      i + batch.length,
      merchantGroups.length,
      "merchants classified",
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

      if (classification.categoryId === group.currentCategoryId) {
        unchanged.push({
          merchantName: group.merchantName,
          category: group.currentCategory,
          count: group.count,
          totalAmount: group.totalAmount,
        });
        continue;
      }

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

  return { changes, unchanged };
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
  log.info(`Scraped ${String(orders.length)} Amazon orders`);

  const matchResult = matchAmazonOrders(amazonTransactions, orders);
  log.info(
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

async function promptConfirm(message: string): Promise<boolean> {
  process.stderr.write(`${message} [y/N] `);
  const reader = Bun.stdin.stream().getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  const input = value ? new TextDecoder().decode(value).trim().toLowerCase() : "";
  return input === "y" || input === "yes";
}

async function promptInteractive(change: ProposedChange): Promise<"apply" | "skip" | "quit"> {
  displaySingleChange(change);
  process.stderr.write("\n  [a]pply / [s]kip / [q]uit: ");
  const reader = Bun.stdin.stream().getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  const input = value ? new TextDecoder().decode(value).trim().toLowerCase() : "s";
  if (input === "a" || input === "apply") return "apply";
  if (input === "q" || input === "quit") return "quit";
  return "skip";
}

async function applySingleChange(change: ProposedChange): Promise<void> {
  if (change.type === "recategorize") {
    log.info(`  Updating ${change.merchantName} → ${change.proposedCategory}`);
    await applyCategory(change.transactionId, change.proposedCategoryId);
  } else if (change.type === "flag") {
    log.info(`  Flagging ${change.merchantName} for review`);
    await flagForReview(change.transactionId);
  } else if (change.splits !== undefined) {
    log.info(`  Splitting ${change.merchantName}`);
    await applySplits(
      change.transactionId,
      change.splits.map((s) => ({
        amount: s.amount,
        categoryId: s.categoryId,
        merchantName: s.itemName,
      })),
    );
  }
}

async function applyChanges(
  changes: ProposedChange[],
  interactive: boolean,
): Promise<void> {
  let applied = 0;

  if (interactive) {
    for (const change of changes) {
      const action = await promptInteractive(change);
      if (action === "quit") {
        log.info(`Stopped. Applied ${String(applied)} of ${String(changes.length)} changes.`);
        return;
      }
      if (action === "skip") continue;
      await applySingleChange(change);
      applied++;
    }
  } else {
    log.info("Applying changes...");
    for (const change of changes) {
      await applySingleChange(change);
      applied++;
    }
  }

  log.info(`Done! Applied ${String(applied)} changes.`);
}

async function main(): Promise<void> {
  const config = getConfig();

  if (config.verbose) {
    setLogLevel("debug");
  }

  initMonarch(config.monarchToken);
  initClaude(config.anthropicApiKey, config.model);

  const hintsPath = path.join(import.meta.dirname, "..", "hints.txt");
  const hintsFile = Bun.file(hintsPath);
  if (await hintsFile.exists()) {
    const hints = await hintsFile.text();
    setUserHints(hints.trim());
    log.info("Loaded user hints");
  }

  const { startDate, endDate } = getDateRange();
  log.info(`Fetching transactions from ${startDate} to ${endDate}...`);

  const [categories, allTransactions] = await Promise.all([
    fetchCategories(),
    fetchAllTransactions(startDate, endDate, config.forceFetch),
  ]);

  log.info(
    `Found ${String(allTransactions.length)} transactions, ${String(categories.length)} categories`,
  );

  let transactions = allTransactions;
  if (config.limit > 0) {
    transactions = transactions.slice(0, config.limit);
    log.info(`Limited to ${String(transactions.length)} transactions`);
  }

  let { amazonTransactions, merchantGroups } =
    groupByMerchant(transactions);

  if (config.sample > 0) {
    merchantGroups = merchantGroups.slice(0, config.sample);
    amazonTransactions = amazonTransactions.slice(0, Math.ceil(config.sample / 2));
    log.info(
      `Sampling ${String(merchantGroups.length)} merchant groups, ${String(amazonTransactions.length)} Amazon transactions`,
    );
  }

  log.info(
    `${String(merchantGroups.length)} merchants, ${String(amazonTransactions.length)} Amazon transactions`,
  );

  const { changes: merchantChanges, unchanged: unchangedMerchants } =
    await classifyMerchants(categories, merchantGroups, config.batchSize);
  displayMerchantChanges(merchantChanges);
  displayUnchangedMerchants(unchangedMerchants);

  let amazonChanges: ProposedChange[] = [];
  let matchResult: MatchResult | null = null;

  if (!config.skipAmazon && amazonTransactions.length > 0) {
    log.info("\n--- Amazon Deep Classification ---");
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
  displayUsageSummary(getUsageSummary());

  if (config.apply) {
    const allChanges = [...merchantChanges, ...amazonChanges];
    if (!config.interactive) {
      const confirmed = await promptConfirm(
        `About to apply ${String(allChanges.length)} changes. Continue?`,
      );
      if (!confirmed) {
        log.info("Aborted.");
        return;
      }
    }
    await applyChanges(allChanges, config.interactive);
  } else {
    log.info("Dry run complete. Use --apply to apply these changes.");
  }
}

try {
  await main();
} catch (error: unknown) {
  log.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
