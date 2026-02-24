#!/usr/bin/env bun
import { getConfig } from "./lib/config.ts";
import {
  initMonarch,
  fetchAllTransactions,
  fetchCategories,
  separateDeepPaths,
} from "./lib/monarch/client.ts";
import type {
  MonarchCategory,
  MonarchTransaction,
} from "./lib/monarch/types.ts";
import { runEnrichmentPipeline } from "./lib/enrichment/pipeline.ts";
import { promptConfirm, applyChanges } from "./lib/apply.ts";
import {
  initClaude,
  setWebSearchEnabled,
  getUsageSummary,
} from "./lib/classifier/claude.ts";
import { classifyTier1 } from "./lib/classifier/tier1.ts";
import { classifyTier2 } from "./lib/classifier/tier2.ts";
import { classifyTier3 } from "./lib/classifier/tier3.ts";
import type { ProposedChange } from "./lib/classifier/types.ts";
import { verifyClassifications } from "./lib/verification/verify.ts";
import {
  loadKnowledgeBase,
  saveKnowledgeBase,
  parseHintsToKB,
  addMerchantToKB,
  learnFromClassification,
} from "./lib/knowledge/store.ts";
import type { MerchantKnowledge } from "./lib/knowledge/types.ts";
import { buildCategoryDefinitions } from "./lib/knowledge/definitions.ts";
import { buildMerchantStats, statsToKBEntries } from "./lib/knowledge/history.ts";
import {
  displayTierBreakdown,
  displayEnrichmentStats,
  displayChanges,
  displaySuggestions,
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

async function loadHints(): Promise<string> {
  const hintsPath = path.join(import.meta.dirname, "..", "hints.txt");
  const hintsFile = Bun.file(hintsPath);
  if (await hintsFile.exists()) {
    const hints = await hintsFile.text();
    setUserHints(hints.trim());
    log.info("Loaded user hints");
    return hints.trim();
  }
  return "";
}

async function buildKnowledgeBase(
  categories: MonarchCategory[],
  allTransactions: MonarchTransaction[],
  hints: string,
  rebuildKb: boolean,
): Promise<Map<string, MerchantKnowledge>> {
  let kb: Map<string, MerchantKnowledge>;

  if (rebuildKb) {
    kb = new Map();
    log.info("Rebuilding knowledge base from scratch");
  } else {
    kb = await loadKnowledgeBase();
  }

  // Import hints into KB (hints always take priority)
  const hintEntries = parseHintsToKB(hints, categories);
  for (const entry of hintEntries) {
    addMerchantToKB(kb, entry);
  }
  if (hintEntries.length > 0) {
    log.info(`Imported ${String(hintEntries.length)} hints into KB`);
  }

  // Build history-based entries for merchants not already in KB
  const stats = buildMerchantStats(allTransactions);
  const historyEntries = statsToKBEntries(stats, 3);
  let historyAdded = 0;
  for (const entry of historyEntries) {
    const key = entry.merchantName.toLowerCase();
    if (!kb.has(key)) {
      addMerchantToKB(kb, entry);
      historyAdded++;
    }
  }
  if (historyAdded > 0) {
    log.info(`Added ${String(historyAdded)} history-based KB entries`);
  }

  await saveKnowledgeBase(kb);
  return kb;
}

async function saveChanges(
  outputPath: string,
  changes: ProposedChange[],
): Promise<void> {
  await Bun.write(outputPath, JSON.stringify(changes, null, 2));
  log.info(`Saved ${String(changes.length)} proposed changes to ${outputPath}`);
}

async function main(): Promise<void> {
  const config = getConfig();

  if (config.verbose) setLogLevel("debug");

  initMonarch(config.monarchToken);
  initClaude(config.anthropicApiKey, config.model);
  setWebSearchEnabled(!config.skipResearch);
  const hints = await loadHints();

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

  // Build category definitions for prompts
  const categoryDefinitions = buildCategoryDefinitions(categories);

  // Build or load the knowledge base
  const knowledgeBase = await buildKnowledgeBase(
    categories,
    allTransactions,
    hints,
    config.rebuildKb,
  );

  // Separate transactions by deep path
  const separated = separateDeepPaths(transactions);

  log.info(
    `${String(separated.regularTransactions.length)} regular, ${String(separated.amazonTransactions.length)} Amazon, ${String(separated.venmoTransactions.length)} Venmo, ${String(separated.biltTransactions.length)} Bilt, ${String(separated.usaaTransactions.length)} USAA, ${String(separated.sclTransactions.length)} SCL, ${String(separated.appleTransactions.length)} Apple, ${String(separated.costcoTransactions.length)} Costco`,
  );

  // === Phase 1: Enrichment ===
  log.info("\n--- Enrichment Phase ---");
  const { enrichedTransactions, stats: enrichmentStats } =
    await runEnrichmentPipeline(config, separated, knowledgeBase);

  displayEnrichmentStats(enrichmentStats);

  // Filter out split transactions
  const classifiable = enrichedTransactions.filter(
    (e) => !e.transaction.isSplitTransaction,
  );

  // === Phase 2: Tiered Classification ===
  log.info("\n--- Classification Phase ---");

  const tier1Txns = classifiable.filter((e) => e.tier === 1);
  const tier2Txns = classifiable.filter((e) => e.tier === 2);
  const tier3Txns = classifiable.filter((e) => e.tier === 3);

  displayTierBreakdown(tier1Txns.length, tier2Txns.length, tier3Txns.length);

  // Tier 1: KB lookup (instant, no API calls)
  const tier1Changes = classifyTier1(tier1Txns, knowledgeBase);

  // Tier 2: Batch classification with enrichment context
  const tier2Changes = await classifyTier2(
    categories,
    categoryDefinitions,
    tier2Txns,
    config.batchSize,
  );

  // Tier 3: Agentic per-transaction classification
  const tier3Changes = await classifyTier3({
    categories,
    definitions: categoryDefinitions,
    transactions: tier3Txns,
    allTransactions,
    knowledgeBase,
  });

  const allChanges = [...tier1Changes, ...tier2Changes, ...tier3Changes];

  // === Phase 3: Verification ===
  log.info("\n--- Verification Phase ---");
  const { changes: verifiedChanges, flagged, suggestions } =
    verifyClassifications(allChanges, enrichedTransactions, knowledgeBase);

  const finalChanges = [...verifiedChanges, ...flagged];

  // Learn from high-confidence classifications
  for (const change of verifiedChanges) {
    if (change.confidence === "high" && change.type === "recategorize") {
      learnFromClassification(
        knowledgeBase,
        change.merchantName,
        change.proposedCategory,
      );
    }
  }
  await saveKnowledgeBase(knowledgeBase);

  // === Display Results ===
  displayChanges(finalChanges);

  displaySummary({
    totalTransactions: classifiable.length,
    tier1Changes: tier1Changes.length,
    tier2Changes: tier2Changes.length,
    tier3Changes: tier3Changes.length,
    flagged: flagged.length,
    enrichmentStats,
  });

  displayUsageSummary(getUsageSummary());

  if (config.suggest) {
    displaySuggestions(suggestions);
  }

  // === Apply or Save ===
  if (config.output !== undefined) {
    await saveChanges(config.output, finalChanges);
  } else if (config.apply) {
    if (!config.interactive) {
      const confirmed = await promptConfirm(
        `About to apply ${String(finalChanges.length)} changes. Continue?`,
      );
      if (!confirmed) {
        log.info("Aborted.");
        return;
      }
    }
    await applyChanges(finalChanges, config.interactive);
  } else {
    log.info(
      "Dry run complete. Use --apply to apply, or --output <path> to save to file.",
    );
  }
}

try {
  await main();
} catch (error: unknown) {
  log.error(
    `Fatal error: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
