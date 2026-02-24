import type { ProposedChange } from "../classifier/types.ts";
import type { EnrichedTransaction } from "../enrichment/types.ts";
import type { EnrichmentSuggestion, MerchantKnowledge } from "../knowledge/types.ts";
import { log } from "../logger.ts";

export type VerificationResult = {
  changes: ProposedChange[];
  flagged: ProposedChange[];
  suggestions: EnrichmentSuggestion[];
};

export function verifyClassifications(
  changes: ProposedChange[],
  enrichedTransactions: EnrichedTransaction[],
  knowledgeBase: Map<string, MerchantKnowledge>,
): VerificationResult {
  const verified: ProposedChange[] = [];
  const flagged: ProposedChange[] = [];

  // Group changes by merchant for cross-transaction consistency
  const merchantChanges = new Map<string, ProposedChange[]>();
  for (const change of changes) {
    const key = change.merchantName.toLowerCase();
    const list = merchantChanges.get(key);
    if (list) {
      list.push(change);
    } else {
      merchantChanges.set(key, [change]);
    }
  }

  for (const change of changes) {
    const issues: string[] = [];

    // Cross-transaction consistency: same merchant should generally get same category
    const samemerchant = merchantChanges.get(
      change.merchantName.toLowerCase(),
    );
    if (samemerchant && samemerchant.length > 1) {
      const categories = new Set(samemerchant.map((c) => c.proposedCategory));
      if (categories.size > 1 && change.type !== "split") {
        issues.push(
          `Inconsistent: same merchant "${change.merchantName}" classified as ${[...categories].join(", ")}`,
        );
      }
    }

    // Split validation: amounts should add up
    if (change.type === "split" && change.splits) {
      const splitSum = change.splits.reduce((s, item) => s + item.amount, 0);
      const txnAmount = Math.abs(change.amount);
      if (Math.abs(splitSum - txnAmount) > 0.02) {
        issues.push(
          `Split amounts don't add up: $${splitSum.toFixed(2)} vs $${txnAmount.toFixed(2)}`,
        );
      }
    }

    if (issues.length > 0) {
      flagged.push({
        ...change,
        type: "flag",
        reason: issues.join("; "),
      });
    } else {
      verified.push(change);
    }
  }

  if (flagged.length > 0) {
    log.info(
      `Verification: ${String(flagged.length)} transactions flagged for review`,
    );
  }

  // Generate enrichment suggestions
  const suggestions = generateSuggestions(
    enrichedTransactions,
    changes,
    knowledgeBase,
  );

  return { changes: verified, flagged, suggestions };
}

type MerchantStat = {
  count: number;
  totalAmount: number;
  deepPath: string;
  hasEnrichment: boolean;
};

function buildMerchantStatsMap(
  enrichedTransactions: EnrichedTransaction[],
): Map<string, MerchantStat> {
  const merchantStats = new Map<string, MerchantStat>();

  for (const enriched of enrichedTransactions) {
    const key = enriched.transaction.merchant.name.toLowerCase();
    const existing = merchantStats.get(key);
    if (existing) {
      existing.count += 1;
      existing.totalAmount += Math.abs(enriched.transaction.amount);
      if (enriched.enrichment) existing.hasEnrichment = true;
    } else {
      merchantStats.set(key, {
        count: 1,
        totalAmount: Math.abs(enriched.transaction.amount),
        deepPath: enriched.deepPath,
        hasEnrichment: enriched.enrichment !== undefined,
      });
    }
  }

  return merchantStats;
}

function suggestHintsForLowConfidence(
  changes: ProposedChange[],
  merchantStats: Map<string, MerchantStat>,
  knowledgeBase: Map<string, MerchantKnowledge>,
): EnrichmentSuggestion[] {
  const suggestions: EnrichmentSuggestion[] = [];
  const lowConfidenceByMerchant = new Map<string, number>();

  for (const change of changes) {
    if (change.confidence === "low" || change.confidence === "medium") {
      const key = change.merchantName.toLowerCase();
      lowConfidenceByMerchant.set(
        key,
        (lowConfidenceByMerchant.get(key) ?? 0) + 1,
      );
    }
  }

  for (const [merchant, lowCount] of lowConfidenceByMerchant) {
    if (lowCount < 2) continue;
    const stats = merchantStats.get(merchant);
    if (!stats) continue;
    if (knowledgeBase.get(merchant)) continue;

    suggestions.push({
      type: "add_hint",
      merchantName: merchant,
      transactionCount: stats.count,
      totalAmount: stats.totalAmount,
      reason: `Classified with low/medium confidence ${String(lowCount)} times. Adding a hint would improve accuracy.`,
      suggestedAction: `Add a line to hints.txt: "- ${merchant} is a [type] -- categorize as [category]."`,
      impact: stats.totalAmount > 500 ? "high" : stats.count > 3 ? "medium" : "low",
    });
  }

  return suggestions;
}

function suggestDeepPathEnrichments(
  merchantStats: Map<string, MerchantStat>,
): EnrichmentSuggestion[] {
  const suggestions: EnrichmentSuggestion[] = [];

  for (const [merchant, stats] of merchantStats) {
    if (stats.hasEnrichment || stats.count < 3 || stats.totalAmount < 200) continue;
    if (stats.deepPath === "regular") continue;

    suggestions.push({
      type: "add_deep_path_data",
      merchantName: merchant,
      transactionCount: stats.count,
      totalAmount: stats.totalAmount,
      reason: `${String(stats.count)} ${stats.deepPath} transactions totaling $${stats.totalAmount.toFixed(0)} with no enrichment data.`,
      suggestedAction: `Ensure ${stats.deepPath} scraping/parsing is configured for this merchant.`,
      impact: stats.totalAmount > 1000 ? "high" : "medium",
    });
  }

  return suggestions;
}

function suggestKBAdditions(
  enrichedTransactions: EnrichedTransaction[],
): EnrichmentSuggestion[] {
  const suggestions: EnrichmentSuggestion[] = [];
  const tier3Merchants = new Map<string, { count: number; totalAmount: number }>();

  for (const enriched of enrichedTransactions) {
    if (enriched.tier !== 3) continue;
    const key = enriched.transaction.merchant.name.toLowerCase();
    const existing = tier3Merchants.get(key);
    if (existing) {
      existing.count += 1;
      existing.totalAmount += Math.abs(enriched.transaction.amount);
    } else {
      tier3Merchants.set(key, {
        count: 1,
        totalAmount: Math.abs(enriched.transaction.amount),
      });
    }
  }

  for (const [merchant, stats] of tier3Merchants) {
    if (stats.count < 2) continue;

    suggestions.push({
      type: "add_to_kb",
      merchantName: merchant,
      transactionCount: stats.count,
      totalAmount: stats.totalAmount,
      reason: `Required tier 3 (agentic) classification ${String(stats.count)} times. Adding to KB would make future runs faster.`,
      suggestedAction: `Add "${merchant}" to hints.txt or let the system learn from confirmed classifications.`,
      impact: stats.totalAmount > 500 ? "high" : "medium",
    });
  }

  return suggestions;
}

function generateSuggestions(
  enrichedTransactions: EnrichedTransaction[],
  changes: ProposedChange[],
  knowledgeBase: Map<string, MerchantKnowledge>,
): EnrichmentSuggestion[] {
  const merchantStats = buildMerchantStatsMap(enrichedTransactions);

  const suggestions = [
    ...suggestHintsForLowConfidence(changes, merchantStats, knowledgeBase),
    ...suggestDeepPathEnrichments(merchantStats),
    ...suggestKBAdditions(enrichedTransactions),
  ];

  // Sort by impact
  const impactOrder = { high: 0, medium: 1, low: 2 };
  return suggestions.toSorted((a, b) => impactOrder[a.impact] - impactOrder[b.impact]);
}
