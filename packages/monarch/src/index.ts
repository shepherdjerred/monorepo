#!/usr/bin/env bun
import { getConfig } from "./lib/config.ts";
import { FINANCE_VAULT_DIR } from "./lib/finance-vault.ts";
import { sampleByMerchant } from "./lib/sampling.ts";
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
import {
  runEnrichmentPipeline,
  unreachableCounts,
} from "./lib/enrichment/pipeline.ts";
import { promptConfirm, applyChanges } from "./lib/apply.ts";
import {
  initLlm,
  setWebSearchEnabled,
  getUsageSummary,
} from "./lib/classifier/llm.ts";
import { classifyTier1 } from "./lib/classifier/tier1.ts";
import { classifyTier2 } from "./lib/classifier/tier2.ts";
import {
  classifyTier3,
  getTier3FailureCounts,
} from "./lib/classifier/tier3.ts";
import type { ProposedChange } from "./lib/classifier/types.ts";
import { verifyClassifications } from "./lib/verification/verify.ts";
import { guardCrossGroupChanges } from "./lib/verification/transfer-guard.ts";
import { writeEnrichmentNotes } from "./lib/enrichment/notes.ts";
import type { EnrichedTransaction } from "./lib/enrichment/types.ts";
import {
  loadKnowledgeBase,
  saveKnowledgeBase,
  parseHintsToKB,
  addMerchantToKB,
  learnFromClassification,
} from "./lib/knowledge/store.ts";
import type { MerchantKnowledge } from "./lib/knowledge/types.ts";
import { buildCategoryDefinitions } from "./lib/knowledge/definitions.ts";
import {
  buildMerchantStats,
  statsToKBEntries,
} from "./lib/knowledge/history.ts";
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

async function loadHints(): Promise<string> {
  const hintsPath = path.join(FINANCE_VAULT_DIR, "hints.txt");
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

// Enrichment and note-writing without classification: no model is called,
// no knowledge base is learned from, and existing categorizations are left
// exactly as they are. This is what makes a full-history pass safe to run.
async function runNotesOnly(
  enriched: EnrichedTransaction[],
  apply: boolean,
): Promise<void> {
  const count = await writeEnrichmentNotes(enriched, !apply);
  log.info(
    apply
      ? `Notes-only run complete: ${String(count)} notes written`
      : `Notes-only dry run: ${String(count)} notes would be written (pass --apply)`,
  );
}

// Applies only what a vendor derived from a source document, and the notes.
// No tier runs, so no model is called and no existing categorization is
// re-litigated — the cheap, repeatable way to keep splits current.
async function runDerivedOnly(
  enriched: EnrichedTransaction[],
  derived: ProposedChange[],
  categories: MonarchCategory[],
  apply: boolean,
): Promise<void> {
  const { changes: guarded, demoted } = guardCrossGroupChanges(
    derived,
    categories,
  );
  displayChanges(guarded);
  if (demoted > 0) {
    log.warn(
      `${String(demoted)} derived changes were demoted to review flags because their legs cross category groups`,
    );
  }
  if (!apply) {
    log.info(
      `Derived-only dry run: ${String(guarded.length)} changes would be applied (pass --apply)`,
    );
    await writeEnrichmentNotes(enriched, true);
    return;
  }
  if ((await applyChanges(guarded, false)) === "quit") return;
  await writeEnrichmentNotes(enriched);
}

async function main(): Promise<void> {
  const config = getConfig();

  if (config.verbose) setLogLevel("debug");

  await initMonarch();
  // Both model-free modes are allowed to run without OPENROUTER_API_KEY
  // (see config.ts), so neither may reach initLlm with an empty key.
  const usesModel = !config.notesOnly && !config.derivedOnly;
  if (usesModel) {
    initLlm(config.openRouterApiKey, config.model);
    setWebSearchEnabled(!config.skipResearch);
  }
  const hints = await loadHints();

  const { since: startDate, until: endDate } = config;
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
  if (config.sample > 0) {
    transactions = sampleByMerchant(transactions, config.sample);
  }

  // Build category definitions for prompts
  const categoryDefinitions = buildCategoryDefinitions(categories);

  // Build or load the knowledge base. The model-free modes never classify, so
  // a knowledge base learned and persisted during one of them would be a pure
  // side effect of a run that promised to change nothing but notes and splits.
  // They read the stored one — still needed for tier assignment — and add
  // nothing to it.
  const knowledgeBase = usesModel
    ? await buildKnowledgeBase(
        categories,
        allTransactions,
        hints,
        config.rebuildKb,
      )
    : await loadKnowledgeBase();

  // Separate transactions by deep path
  const separated = separateDeepPaths(transactions);

  log.info(
    `${String(separated.regularTransactions.length)} regular, ${String(separated.amazonTransactions.length)} Amazon, ${String(separated.venmoTransactions.length)} Venmo, ${String(separated.biltTransactions.length)} Bilt, ${String(separated.usaaTransactions.length)} USAA, ${String(separated.sclTransactions.length)} SCL, ${String(separated.appleTransactions.length)} Apple, ${String(separated.costcoTransactions.length)} Costco, ${String(separated.paystubTransactions.length)} payroll, ${String(separated.equityTransactions.length)} equity, ${String(separated.loanTransactions.length)} loan`,
  );

  // === Phase 1: Enrichment ===
  log.info("\n--- Enrichment Phase ---");
  const {
    enrichedTransactions,
    stats: enrichmentStats,
    changes: derivedChanges,
  } = await runEnrichmentPipeline(config, separated, knowledgeBase, categories);

  displayEnrichmentStats(enrichmentStats, unreachableCounts(separated));

  if (config.notesOnly) {
    await runNotesOnly(enrichedTransactions, config.apply);
    return;
  }

  if (config.derivedOnly) {
    await runDerivedOnly(
      enrichedTransactions,
      derivedChanges,
      categories,
      config.apply,
    );
    return;
  }

  // Nothing downstream merges two proposals for one transaction — they would
  // both be applied — so a transaction a vendor already decided from its
  // source document does not also go to a tier to be guessed at.
  const decided = new Set(derivedChanges.map((c) => c.transactionId));
  const classifiable = enrichedTransactions.filter(
    (e) => !e.transaction.isSplitTransaction && !decided.has(e.transaction.id),
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
  const tier2Changes = await classifyTier2({
    definitions: categoryDefinitions,
    transactions: tier2Txns,
    batchSize: config.batchSize,
    checkpointFile: config.checkpointFile,
  });

  // Tier 3: Agentic per-transaction classification
  const tier3Changes = await classifyTier3({
    categories,
    definitions: categoryDefinitions,
    transactions: tier3Txns,
    allTransactions,
    knowledgeBase,
  });

  const allChanges = [
    ...derivedChanges,
    ...tier1Changes,
    ...tier2Changes,
    ...tier3Changes,
  ];

  // === Phase 3: Verification ===
  log.info("\n--- Verification Phase ---");
  const {
    changes: verifiedChanges,
    flagged,
    suggestions,
  } = verifyClassifications(allChanges, enrichedTransactions, knowledgeBase);

  const { changes: guardedChanges } = guardCrossGroupChanges(
    [...verifiedChanges, ...flagged],
    categories,
  );
  const finalChanges = guardedChanges;

  // Learn from high-confidence classifications (guarded list: demoted
  // cross-group changes are flags there and must not teach the KB)
  for (const change of guardedChanges) {
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

  const tier3Failures = getTier3FailureCounts();
  const tier3FailureTotal = Object.values(tier3Failures).reduce(
    (a, b) => a + b,
    0,
  );
  if (tier3FailureTotal > 0) {
    log.warn(
      `Tier 3 failures (transactions left uncategorized): ${Object.entries(
        tier3Failures,
      )
        .map(([reason, count]) => `${reason}=${String(count)}`)
        .join(", ")}`,
    );
  }

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
    // Quitting the interactive review is a request to stop mutating the
    // account, not just to stop applying categories.
    if ((await applyChanges(finalChanges, config.interactive)) === "quit") {
      log.info("Stopped before writing enrichment notes.");
      return;
    }
    await writeEnrichmentNotes(enrichedTransactions);
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
