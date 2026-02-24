import type { Config } from "../config.ts";
import type { MonarchTransaction } from "../monarch/types.ts";
import type { SeparateDeepPathsResult } from "../monarch/client.ts";
import type { TransactionEnrichment, EnrichedTransaction } from "./types.ts";
import type { MerchantKnowledge } from "../knowledge/types.ts";
import { enrichAmazon } from "../amazon/enrich.ts";
import { enrichVenmo } from "../venmo/enrich.ts";
import { enrichBilt } from "../conservice/enrich.ts";
import { enrichUsaa } from "../usaa/enrich.ts";
import { enrichScl } from "../scl/enrich.ts";
import { enrichApple } from "../apple/enrich.ts";
import { enrichCostco } from "../costco/enrich.ts";
import { assignTier } from "./router.ts";
import { log } from "../logger.ts";

export type EnrichmentStats = {
  amazon: { matched: number; total: number };
  venmo: { matched: number; total: number };
  bilt: { matched: number; total: number };
  usaa: { matched: number; total: number };
  scl: { matched: number; total: number };
  apple: { matched: number; total: number };
  costco: { matched: number; total: number };
  tier1Count: number;
  tier2Count: number;
  tier3Count: number;
};

export type EnrichmentResult = {
  enrichedTransactions: EnrichedTransaction[];
  stats: EnrichmentStats;
};

type DeepPathKey =
  | "amazon"
  | "venmo"
  | "bilt"
  | "usaa"
  | "scl"
  | "apple"
  | "costco";

type EnrichResult = {
  enrichments: Map<string, TransactionEnrichment>;
  matchRate: { matched: number; total: number };
  key: DeepPathKey;
};

async function enrichWithKey(
  promise: Promise<{ enrichments: Map<string, TransactionEnrichment>; matchRate: { matched: number; total: number } }>,
  key: DeepPathKey,
): Promise<EnrichResult> {
  const r = await promise;
  return { ...r, key };
}

async function runDeepPathEnrichments(
  config: Config,
  separated: SeparateDeepPathsResult,
): Promise<EnrichResult[]> {
  const tasks: Promise<EnrichResult>[] = [];

  if (!config.skipAmazon && separated.amazonTransactions.length > 0) {
    tasks.push(enrichWithKey(
      enrichAmazon(config.amazonYears, config.forceScrape, separated.amazonTransactions),
      "amazon",
    ));
  }

  if (!config.skipVenmo && config.venmoCsv !== undefined && separated.venmoTransactions.length > 0) {
    tasks.push(enrichWithKey(
      enrichVenmo(config, separated.venmoTransactions),
      "venmo",
    ));
  }

  if (!config.skipBilt && separated.biltTransactions.length > 0) {
    tasks.push(enrichWithKey(
      enrichBilt(separated.biltTransactions),
      "bilt",
    ));
  }

  if (!config.skipUsaa && separated.usaaTransactions.length > 0) {
    tasks.push(enrichWithKey(
      enrichUsaa(separated.usaaTransactions),
      "usaa",
    ));
  }

  if (!config.skipScl && config.sclCsv !== undefined && separated.sclTransactions.length > 0) {
    tasks.push(enrichWithKey(
      enrichScl(config.sclCsv, separated.sclTransactions),
      "scl",
    ));
  }

  if (!config.skipApple && config.appleMailDir !== undefined && separated.appleTransactions.length > 0) {
    tasks.push(enrichWithKey(
      enrichApple(config.appleMailDir, separated.appleTransactions),
      "apple",
    ));
  }

  // Costco is sync
  if (!config.skipCostco && separated.costcoTransactions.length > 0) {
    const r = enrichCostco(separated.costcoTransactions);
    tasks.push(Promise.resolve({ ...r, key: "costco" as const }));
  }

  return Promise.all(tasks);
}

function buildEnrichedList(
  separated: SeparateDeepPathsResult,
  allEnrichments: Map<string, TransactionEnrichment>,
  knowledgeBase: Map<string, MerchantKnowledge>,
): EnrichedTransaction[] {
  const enrichedTransactions: EnrichedTransaction[] = [];

  const deepPathMap: [DeepPathKey, MonarchTransaction[]][] = [
    ["amazon", separated.amazonTransactions],
    ["venmo", separated.venmoTransactions],
    ["bilt", separated.biltTransactions],
    ["usaa", separated.usaaTransactions],
    ["scl", separated.sclTransactions],
    ["apple", separated.appleTransactions],
    ["costco", separated.costcoTransactions],
  ];

  for (const [deepPath, transactions] of deepPathMap) {
    for (const txn of transactions) {
      const enrichment = allEnrichments.get(txn.id);
      const tier = assignTier(txn, enrichment, knowledgeBase);
      enrichedTransactions.push({ transaction: txn, enrichment, tier, deepPath });
    }
  }

  for (const txn of separated.regularTransactions) {
    const enrichment = allEnrichments.get(txn.id);
    const tier = assignTier(txn, enrichment, knowledgeBase);
    enrichedTransactions.push({ transaction: txn, enrichment, tier, deepPath: "regular" });
  }

  return enrichedTransactions;
}

export async function runEnrichmentPipeline(
  config: Config,
  separated: SeparateDeepPathsResult,
  knowledgeBase: Map<string, MerchantKnowledge>,
): Promise<EnrichmentResult> {
  const stats: EnrichmentStats = {
    amazon: { matched: 0, total: 0 },
    venmo: { matched: 0, total: 0 },
    bilt: { matched: 0, total: 0 },
    usaa: { matched: 0, total: 0 },
    scl: { matched: 0, total: 0 },
    apple: { matched: 0, total: 0 },
    costco: { matched: 0, total: 0 },
    tier1Count: 0,
    tier2Count: 0,
    tier3Count: 0,
  };

  const allEnrichments = new Map<string, TransactionEnrichment>();
  const results = await runDeepPathEnrichments(config, separated);

  for (const result of results) {
    for (const [id, enrichment] of result.enrichments) {
      allEnrichments.set(id, enrichment);
    }
    stats[result.key] = result.matchRate;
  }

  log.info(`Enriched ${String(allEnrichments.size)} transactions from deep paths`);

  const enrichedTransactions = buildEnrichedList(separated, allEnrichments, knowledgeBase);

  stats.tier1Count = enrichedTransactions.filter((t) => t.tier === 1).length;
  stats.tier2Count = enrichedTransactions.filter((t) => t.tier === 2).length;
  stats.tier3Count = enrichedTransactions.filter((t) => t.tier === 3).length;

  log.info(
    `Tier routing: ${String(stats.tier1Count)} tier 1, ${String(stats.tier2Count)} tier 2, ${String(stats.tier3Count)} tier 3`,
  );

  return { enrichedTransactions, stats };
}
