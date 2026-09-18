import type { Config } from "../config.ts";
import type { MonarchTransaction } from "../monarch/types.ts";
import type { SeparateDeepPathsResult } from "../monarch/client.ts";
import type { TransactionEnrichment, EnrichedTransaction } from "./types.ts";
import type { MerchantKnowledge } from "../knowledge/types.ts";
import type { ProposedChange } from "../classifier/types.ts";
import type { MonarchCategory } from "../monarch/types.ts";
import { enrichAmazon } from "../amazon/enrich.ts";
import { enrichVenmo } from "../venmo/enrich.ts";
import { enrichBilt } from "../conservice/enrich.ts";
import { enrichUsaa } from "../usaa/enrich.ts";
import { enrichScl } from "../scl/enrich.ts";
import { enrichApple } from "../apple/enrich.ts";
import { enrichCostco } from "../costco/enrich.ts";
import { enrichPaystub } from "../paystub/enrich.ts";
import { enrichEquity } from "../equity/enrich.ts";
import { enrichLoan } from "../loan/enrich.ts";
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
  paystub: { matched: number; total: number };
  equity: { matched: number; total: number };
  loan: { matched: number; total: number };
  tier1Count: number;
  tier2Count: number;
  tier3Count: number;
};

// Transactions a previous run already split. Every matcher skips them so it
// cannot split them twice, which means they are not failures to match — but a
// bare "0/24" reads exactly like one. Counting them keeps the report honest
// about which paths still have work left.
export function alreadySplitCounts(
  separated: SeparateDeepPathsResult,
): Record<DeepPathKey, number> {
  const counts: Record<DeepPathKey, number> = {
    amazon: 0,
    venmo: 0,
    bilt: 0,
    usaa: 0,
    scl: 0,
    apple: 0,
    costco: 0,
    paystub: 0,
    equity: 0,
    loan: 0,
  };
  for (const [key, transactions] of deepPathBuckets(separated)) {
    counts[key] = transactions.filter((t) => t.isSplitTransaction).length;
  }
  return counts;
}

export type EnrichmentResult = {
  enrichedTransactions: EnrichedTransaction[];
  stats: EnrichmentStats;
  // Changes a vendor derived rather than a model proposing them.
  changes: ProposedChange[];
};

type DeepPathKey =
  | "amazon"
  | "venmo"
  | "bilt"
  | "usaa"
  | "scl"
  | "apple"
  | "costco"
  | "paystub"
  | "equity"
  | "loan";

// What every vendor returns. Written once: the same shape used to be spelled
// out inline in three places, so any new field cost three parallel edits.
//
// `changes` is for facts a vendor can state exactly rather than infer — an
// amortization schedule prints the principal and interest of a payment, and no
// model should be asked to do that arithmetic. They are merged with the tiers'
// proposals and still pass through verification and the cross-group guard: a
// better producer, not a bypass.
export type VendorEnrichOutput = {
  enrichments: Map<string, TransactionEnrichment>;
  matchRate: { matched: number; total: number };
  changes?: ProposedChange[] | undefined;
};

type EnrichResult = VendorEnrichOutput & { key: DeepPathKey };

async function enrichWithKey(
  promise: Promise<VendorEnrichOutput>,
  key: DeepPathKey,
): Promise<EnrichResult> {
  const r = await promise;
  return { ...r, key };
}

// Each vendor declares when it can run and how. A table keeps adding a
// source to one entry instead of another branch in a growing if-chain.
type DeepPathSpec = {
  key: DeepPathKey;
  transactions: MonarchTransaction[];
  skipped: boolean;
  // Some sources need an input path that may be absent.
  ready?: boolean;
  run: () => Promise<VendorEnrichOutput>;
};

function deepPathSpecs(
  config: Config,
  separated: SeparateDeepPathsResult,
  categories: MonarchCategory[],
): DeepPathSpec[] {
  return [
    {
      key: "amazon",
      transactions: separated.amazonTransactions,
      skipped: config.skipAmazon,
      run: () =>
        enrichAmazon(
          config.amazonYears,
          config.forceScrape,
          separated.amazonTransactions,
        ),
    },
    {
      key: "venmo",
      transactions: separated.venmoTransactions,
      skipped: config.skipVenmo,
      ready: config.venmoCsv !== undefined,
      run: () => enrichVenmo(config, separated.venmoTransactions),
    },
    {
      key: "bilt",
      transactions: separated.biltTransactions,
      skipped: config.skipBilt,
      run: () => enrichBilt(separated.biltTransactions),
    },
    {
      key: "usaa",
      transactions: separated.usaaTransactions,
      skipped: config.skipUsaa,
      run: () => enrichUsaa(separated.usaaTransactions),
    },
    {
      key: "scl",
      transactions: separated.sclTransactions,
      skipped: config.skipScl,
      ready: config.sclCsv !== undefined,
      run: () => enrichScl(config.sclCsv ?? "", separated.sclTransactions),
    },
    {
      key: "apple",
      transactions: separated.appleTransactions,
      skipped: config.skipApple,
      run: () => enrichApple(separated.appleTransactions),
    },
    {
      key: "paystub",
      transactions: separated.paystubTransactions,
      skipped: config.skipPaystub,
      run: () => enrichPaystub(separated.paystubTransactions),
    },
    {
      key: "costco",
      transactions: separated.costcoTransactions,
      skipped: config.skipCostco,
      run: () => enrichCostco(separated.costcoTransactions),
    },
    {
      key: "equity",
      transactions: separated.equityTransactions,
      skipped: config.skipEquity,
      run: () => enrichEquity(separated.equityTransactions),
    },
    {
      key: "loan",
      transactions: separated.loanTransactions,
      skipped: config.skipLoan,
      run: () => enrichLoan(separated.loanTransactions, categories),
    },
  ];
}

async function runDeepPathEnrichments(
  config: Config,
  separated: SeparateDeepPathsResult,
  categories: MonarchCategory[],
): Promise<EnrichResult[]> {
  const tasks = deepPathSpecs(config, separated, categories)
    .filter(
      (spec) =>
        !spec.skipped && spec.transactions.length > 0 && (spec.ready ?? true),
    )
    .map((spec) => enrichWithKey(spec.run(), spec.key));

  return Promise.all(tasks);
}

function deepPathBuckets(
  separated: SeparateDeepPathsResult,
): [DeepPathKey, MonarchTransaction[]][] {
  return [
    ["amazon", separated.amazonTransactions],
    ["venmo", separated.venmoTransactions],
    ["bilt", separated.biltTransactions],
    ["usaa", separated.usaaTransactions],
    ["scl", separated.sclTransactions],
    ["apple", separated.appleTransactions],
    ["costco", separated.costcoTransactions],
    ["paystub", separated.paystubTransactions],
    ["equity", separated.equityTransactions],
    ["loan", separated.loanTransactions],
  ];
}

function buildEnrichedList(
  separated: SeparateDeepPathsResult,
  allEnrichments: Map<string, TransactionEnrichment>,
  knowledgeBase: Map<string, MerchantKnowledge>,
): EnrichedTransaction[] {
  const enrichedTransactions: EnrichedTransaction[] = [];

  for (const [deepPath, transactions] of deepPathBuckets(separated)) {
    for (const txn of transactions) {
      const enrichment = allEnrichments.get(txn.id);
      const tier = assignTier(txn, enrichment, knowledgeBase);
      enrichedTransactions.push({
        transaction: txn,
        enrichment,
        tier,
        deepPath,
      });
    }
  }

  for (const txn of separated.regularTransactions) {
    const enrichment = allEnrichments.get(txn.id);
    const tier = assignTier(txn, enrichment, knowledgeBase);
    enrichedTransactions.push({
      transaction: txn,
      enrichment,
      tier,
      deepPath: "regular",
    });
  }

  return enrichedTransactions;
}

export async function runEnrichmentPipeline(
  config: Config,
  separated: SeparateDeepPathsResult,
  knowledgeBase: Map<string, MerchantKnowledge>,
  categories: MonarchCategory[],
): Promise<EnrichmentResult> {
  const stats: EnrichmentStats = {
    amazon: { matched: 0, total: 0 },
    venmo: { matched: 0, total: 0 },
    bilt: { matched: 0, total: 0 },
    usaa: { matched: 0, total: 0 },
    scl: { matched: 0, total: 0 },
    apple: { matched: 0, total: 0 },
    costco: { matched: 0, total: 0 },
    paystub: { matched: 0, total: 0 },
    equity: { matched: 0, total: 0 },
    loan: { matched: 0, total: 0 },
    tier1Count: 0,
    tier2Count: 0,
    tier3Count: 0,
  };

  const allEnrichments = new Map<string, TransactionEnrichment>();
  // --skip-enrich routes every transaction through classification with no
  // deep-path context, which is the fast path when only categories matter.
  const results = config.skipEnrich
    ? []
    : await runDeepPathEnrichments(config, separated, categories);
  if (config.skipEnrich) {
    log.info("Skipping deep-path enrichment (--skip-enrich)");
  }

  const changes: ProposedChange[] = [];
  for (const result of results) {
    for (const [id, enrichment] of result.enrichments) {
      allEnrichments.set(id, enrichment);
    }
    stats[result.key] = result.matchRate;
    if (result.changes !== undefined) changes.push(...result.changes);
  }
  if (changes.length > 0) {
    log.info(
      `${String(changes.length)} changes derived from source documents rather than proposed by a model`,
    );
  }

  log.info(
    `Enriched ${String(allEnrichments.size)} transactions from deep paths`,
  );

  const enrichedTransactions = buildEnrichedList(
    separated,
    allEnrichments,
    knowledgeBase,
  );

  stats.tier1Count = enrichedTransactions.filter((t) => t.tier === 1).length;
  stats.tier2Count = enrichedTransactions.filter((t) => t.tier === 2).length;
  stats.tier3Count = enrichedTransactions.filter((t) => t.tier === 3).length;

  log.info(
    `Tier routing: ${String(stats.tier1Count)} tier 1, ${String(stats.tier2Count)} tier 2, ${String(stats.tier3Count)} tier 3`,
  );

  return { enrichedTransactions, stats, changes };
}
