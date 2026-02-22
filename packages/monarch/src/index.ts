#!/usr/bin/env bun
import { getConfig } from "./lib/config.ts";
import type { Config } from "./lib/config.ts";
import {
  initMonarch,
  fetchAllTransactions,
  fetchCategories,
  separateDeepPaths,
} from "./lib/monarch/client.ts";
import type { MonarchCategory, MonarchTransaction } from "./lib/monarch/types.ts";
import { groupByWeek, buildWeekWindows } from "./lib/monarch/weeks.ts";
import type { WeekGroup } from "./lib/monarch/weeks.ts";
import { buildResolvedMap } from "./lib/enrichment.ts";
import { promptConfirm, applyChanges } from "./lib/apply.ts";
import {
  initClaude,
  classifyWeek,
  classifyAmazonBatch,
  computeSplits,
  getUsageSummary,
} from "./lib/classifier/claude.ts";
import { scrapeAmazonOrders } from "./lib/amazon/scraper.ts";
import { matchAmazonOrders } from "./lib/amazon/matcher.ts";
import type { MatchResult } from "./lib/amazon/matcher.ts";
import { classifyVenmo } from "./lib/venmo/classify.ts";
import type { VenmoMatchResult } from "./lib/venmo/matcher.ts";
import { classifyBilt } from "./lib/conservice/classify.ts";
import { classifyUsaa } from "./lib/usaa/classify.ts";
import { classifyScl } from "./lib/scl/classify.ts";
import { classifyApple } from "./lib/apple/classify.ts";
import type { AppleMatchResult } from "./lib/apple/matcher.ts";
import { classifyCostco } from "./lib/costco/classify.ts";
import type { CostcoMatchResult } from "./lib/costco/matcher.ts";
import type { ProposedChange, ProposedSplit } from "./lib/classifier/types.ts";
import {
  displayWeekChanges,
  displayAmazonChanges,
  displayVenmoChanges,
  displayBiltChanges,
  displayUsaaChanges,
  displaySclChanges,
  displayAppleChanges,
  displayCostcoChanges,
  displaySummary,
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
  const batchSize = 20;

  for (let i = 0; i < matchResult.matched.length; i += batchSize) {
    const batch = matchResult.matched.slice(i, i + batchSize);
    log.progress(i + batch.length, matchResult.matched.length, "Amazon orders classified");

    const orderInputs = batch.map((match, idx) => ({
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
  }

  return { changes, matchResult };
}

type DeepClassifyResult = {
  venmoChanges: ProposedChange[];
  venmoMatchResult: VenmoMatchResult | null;
  biltChanges: ProposedChange[];
  usaaChanges: ProposedChange[];
  sclChanges: ProposedChange[];
  appleChanges: ProposedChange[];
  appleMatchResult: AppleMatchResult | null;
  costcoChanges: ProposedChange[];
  costcoMatchResult: CostcoMatchResult | null;
  amazonChanges: ProposedChange[];
  matchResult: MatchResult | null;
};

type DeepClassifyOptions = {
  config: Config;
  categories: MonarchCategory[];
  venmo: MonarchTransaction[];
  bilt: MonarchTransaction[];
  usaa: MonarchTransaction[];
  scl: MonarchTransaction[];
  apple: MonarchTransaction[];
  costco: MonarchTransaction[];
  amazon: MonarchTransaction[];
};

async function deepClassify(options: DeepClassifyOptions): Promise<DeepClassifyResult> {
  const { config, categories, venmo: venmoTransactions, bilt: biltTransactions, usaa: usaaTransactions, scl: sclTransactions, apple: appleTransactions, costco: costcoTransactions, amazon: amazonTransactions } = options;
  let venmoChanges: ProposedChange[] = [];
  let venmoMatchResult: VenmoMatchResult | null = null;
  if (!config.skipVenmo && config.venmoCsv !== undefined && venmoTransactions.length > 0) {
    log.info("\n--- Venmo Deep Classification ---");
    const result = await classifyVenmo(config, categories, venmoTransactions);
    venmoChanges = result.changes;
    venmoMatchResult = result.matchResult;
    displayVenmoChanges(venmoChanges, venmoMatchResult);
  }

  let biltChanges: ProposedChange[] = [];
  if (!config.skipBilt && config.conserviceCookies !== undefined && biltTransactions.length > 0) {
    log.info("\n--- Bilt/Conservice Deep Classification ---");
    const result = await classifyBilt(config, categories, biltTransactions);
    biltChanges = result.changes;
    displayBiltChanges(biltChanges, result.matches);
  }

  let usaaChanges: ProposedChange[] = [];
  if (!config.skipUsaa && usaaTransactions.length > 0) {
    log.info("\n--- USAA Insurance Split ---");
    usaaChanges = classifyUsaa(categories, usaaTransactions);
    displayUsaaChanges(usaaChanges);
  }

  let sclChanges: ProposedChange[] = [];
  if (!config.skipScl && config.sclCsv !== undefined && sclTransactions.length > 0) {
    log.info("\n--- Seattle City Light Classification ---");
    sclChanges = await classifyScl(config.sclCsv, categories, sclTransactions);
    displaySclChanges(sclChanges);
  }

  let appleChanges: ProposedChange[] = [];
  let appleMatchResult: AppleMatchResult | null = null;
  if (!config.skipApple && config.appleMailDir !== undefined && appleTransactions.length > 0) {
    log.info("\n--- Apple Deep Classification ---");
    const result = await classifyApple(config.appleMailDir, categories, appleTransactions);
    appleChanges = result.changes;
    appleMatchResult = result.matchResult;
    displayAppleChanges(appleChanges, appleMatchResult);
  }

  let costcoChanges: ProposedChange[] = [];
  let costcoMatchResult: CostcoMatchResult | null = null;
  if (!config.skipCostco && costcoTransactions.length > 0) {
    log.info("\n--- Costco Deep Classification ---");
    const result = await classifyCostco(categories, costcoTransactions, config.forceScrape);
    costcoChanges = result.changes;
    costcoMatchResult = result.matchResult;
    displayCostcoChanges(costcoChanges, costcoMatchResult);
  }

  let amazonChanges: ProposedChange[] = [];
  let matchResult: MatchResult | null = null;
  if (!config.skipAmazon && amazonTransactions.length > 0) {
    log.info("\n--- Amazon Deep Classification ---");
    const result = await classifyAmazon(config, categories, amazonTransactions);
    amazonChanges = result.changes;
    matchResult = result.matchResult;
    displayAmazonChanges(amazonChanges, matchResult);
  }

  return { venmoChanges, venmoMatchResult, biltChanges, usaaChanges, sclChanges, appleChanges, appleMatchResult, costcoChanges, costcoMatchResult, amazonChanges, matchResult };
}

async function saveChanges(outputPath: string, changes: ProposedChange[]): Promise<void> {
  await Bun.write(outputPath, JSON.stringify(changes, null, 2));
  log.info(`Saved ${String(changes.length)} proposed changes to ${outputPath}`);
}

type ClassifyByWeekOptions = {
  categories: MonarchCategory[];
  regularTransactions: MonarchTransaction[];
  deep: DeepClassifyResult;
  amazonTransactions: MonarchTransaction[];
  venmoTransactions: MonarchTransaction[];
  biltTransactions: MonarchTransaction[];
  usaaTransactions: MonarchTransaction[];
  sclTransactions: MonarchTransaction[];
  appleTransactions: MonarchTransaction[];
  costcoTransactions: MonarchTransaction[];
};

async function classifyByWeek(
  opts: ClassifyByWeekOptions,
): Promise<{ weekChanges: ProposedChange[]; weekGroups: WeekGroup[] }> {
  const { categories, regularTransactions, deep } = opts;

  const allDeepChanges = [
    ...deep.venmoChanges, ...deep.biltChanges,
    ...deep.usaaChanges, ...deep.sclChanges,
    ...deep.appleChanges, ...deep.costcoChanges,
    ...deep.amazonChanges,
  ];
  const resolvedMap = buildResolvedMap(allDeepChanges);

  const allTransactions = [
    ...regularTransactions,
    ...opts.amazonTransactions, ...opts.venmoTransactions, ...opts.biltTransactions,
    ...opts.usaaTransactions, ...opts.sclTransactions,
    ...opts.appleTransactions, ...opts.costcoTransactions,
  ];
  const weekGroups = groupByWeek(allTransactions);
  const windows = buildWeekWindows(weekGroups);

  log.info(`\n--- Week-Based Classification (${String(weekGroups.length)} weeks) ---`);

  const weekChanges: ProposedChange[] = [];
  const previousResults = new Map<string, string>();

  for (let i = 0; i < windows.length; i++) {
    const window = windows[i];
    if (!window) continue;

    const classifiable = window.current.transactions.filter(
      (t) => !resolvedMap.has(t.id),
    );

    if (classifiable.length === 0) {
      log.debug(`  ${window.current.weekKey}: no transactions to classify, skipping`);
      continue;
    }

    log.progress(i + 1, windows.length, `weeks classified (${window.current.weekKey})`);

    const result = await classifyWeek(categories, window, resolvedMap, previousResults);

    for (const classification of result.transactions) {
      const txn = window.current.transactions.find((t) => t.id === classification.transactionId);
      if (!txn) continue;

      previousResults.set(classification.transactionId, classification.categoryName);

      if (classification.categoryId === txn.category.id) continue;

      weekChanges.push({
        transactionId: classification.transactionId,
        transactionDate: txn.date,
        merchantName: txn.merchant.name,
        amount: txn.amount,
        currentCategory: txn.category.name,
        currentCategoryId: txn.category.id,
        proposedCategory: classification.categoryName,
        proposedCategoryId: classification.categoryId,
        confidence: classification.confidence,
        type: "recategorize",
      });
    }
  }

  return { weekChanges, weekGroups };
}

async function loadHints(): Promise<void> {
  const hintsPath = path.join(import.meta.dirname, "..", "hints.txt");
  const hintsFile = Bun.file(hintsPath);
  if (await hintsFile.exists()) {
    const hints = await hintsFile.text();
    setUserHints(hints.trim());
    log.info("Loaded user hints");
  }
}

async function main(): Promise<void> {
  const config = getConfig();

  if (config.verbose) setLogLevel("debug");

  initMonarch(config.monarchToken);
  initClaude(config.anthropicApiKey, config.model);
  await loadHints();

  const { startDate, endDate } = getDateRange();
  log.info(`Fetching transactions from ${startDate} to ${endDate}...`);

  const [categories, allTransactions] = await Promise.all([
    fetchCategories(),
    fetchAllTransactions(startDate, endDate, config.forceFetch),
  ]);

  log.info(`Found ${String(allTransactions.length)} transactions, ${String(categories.length)} categories`);

  let transactions = allTransactions;
  if (config.limit > 0) {
    transactions = transactions.slice(0, config.limit);
    log.info(`Limited to ${String(transactions.length)} transactions`);
  }

  const separated = separateDeepPaths(transactions);
  let { amazonTransactions, venmoTransactions, biltTransactions } = separated;
  const { usaaTransactions, sclTransactions, appleTransactions, costcoTransactions, regularTransactions } = separated;

  if (config.sample > 0) {
    amazonTransactions = amazonTransactions.slice(0, Math.ceil(config.sample / 2));
    venmoTransactions = venmoTransactions.slice(0, Math.ceil(config.sample / 2));
    biltTransactions = biltTransactions.slice(0, Math.ceil(config.sample / 2));
  }

  log.info(
    `${String(regularTransactions.length)} regular, ${String(amazonTransactions.length)} Amazon, ${String(venmoTransactions.length)} Venmo, ${String(biltTransactions.length)} Bilt, ${String(usaaTransactions.length)} USAA, ${String(sclTransactions.length)} SCL, ${String(appleTransactions.length)} Apple, ${String(costcoTransactions.length)} Costco`,
  );

  // 1. Run deep paths first to get resolved transactions
  const deep = await deepClassify({
    config, categories,
    venmo: venmoTransactions, bilt: biltTransactions,
    usaa: usaaTransactions, scl: sclTransactions,
    apple: appleTransactions, costco: costcoTransactions,
    amazon: amazonTransactions,
  });

  // 2. Build week groups and classify
  const { weekChanges, weekGroups } = await classifyByWeek({
    categories, regularTransactions, deep,
    amazonTransactions, venmoTransactions, biltTransactions,
    usaaTransactions, sclTransactions, appleTransactions, costcoTransactions,
  });

  displayWeekChanges(weekChanges, weekGroups);

  displaySummary({ weekChanges, ...deep });
  displayUsageSummary(getUsageSummary());

  const allChanges = [...weekChanges, ...deep.venmoChanges, ...deep.biltChanges, ...deep.usaaChanges, ...deep.sclChanges, ...deep.appleChanges, ...deep.costcoChanges, ...deep.amazonChanges];

  if (config.output !== undefined) {
    await saveChanges(config.output, allChanges);
  } else if (config.apply) {
    if (!config.interactive) {
      const confirmed = await promptConfirm(`About to apply ${String(allChanges.length)} changes. Continue?`);
      if (!confirmed) {
        log.info("Aborted.");
        return;
      }
    }
    await applyChanges(allChanges, config.interactive);
  } else {
    log.info("Dry run complete. Use --apply to apply, or --output <path> to save to file.");
  }
}

try {
  await main();
} catch (error: unknown) {
  log.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
