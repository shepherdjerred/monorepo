import type { MonarchTransaction } from "../monarch/types.ts";
import type { MerchantKnowledge } from "./types.ts";
import type { Confidence } from "../classifier/types.ts";

type MerchantStats = {
  merchantName: string;
  totalCount: number;
  categories: Map<string, { count: number; id: string }>;
};

export function buildMerchantStats(
  transactions: MonarchTransaction[],
): Map<string, MerchantStats> {
  const stats = new Map<string, MerchantStats>();

  for (const txn of transactions) {
    const key = txn.merchant.name.toLowerCase();
    let entry = stats.get(key);
    if (!entry) {
      entry = {
        merchantName: txn.merchant.name,
        totalCount: 0,
        categories: new Map(),
      };
      stats.set(key, entry);
    }

    entry.totalCount += 1;
    const catEntry = entry.categories.get(txn.category.name);
    if (catEntry) {
      catEntry.count += 1;
    } else {
      entry.categories.set(txn.category.name, {
        count: 1,
        id: txn.category.id,
      });
    }
  }

  return stats;
}

export function statsToKBEntries(
  stats: Map<string, MerchantStats>,
  minTransactions: number,
): MerchantKnowledge[] {
  const entries: MerchantKnowledge[] = [];

  for (const stat of stats.values()) {
    if (stat.totalCount < minTransactions) continue;

    const sortedCategories = [...stat.categories.entries()].toSorted(
      (a, b) => b[1].count - a[1].count,
    );

    const topCategory = sortedCategories[0];
    if (!topCategory) continue;

    const [topCatName, topCatData] = topCategory;
    const topRatio = topCatData.count / stat.totalCount;
    const multiCategory = topRatio < 0.85 || sortedCategories.length > 2;

    let confidence: Confidence;
    if (topRatio >= 0.95 && stat.totalCount >= 5) {
      confidence = "high";
    } else if (topRatio >= 0.8) {
      confidence = "medium";
    } else {
      confidence = "low";
    }

    const categoryHistory = sortedCategories.map(([name, data]) => ({
      categoryName: name,
      count: data.count,
    }));

    entries.push({
      merchantName: stat.merchantName,
      aliases: [],
      merchantType: "",
      description: "",
      multiCategory,
      defaultCategory: multiCategory
        ? undefined
        : { id: topCatData.id, name: topCatName },
      categoryHistory,
      source: "history",
      confidence,
      lastUpdated: new Date().toISOString(),
    });
  }

  return entries;
}
