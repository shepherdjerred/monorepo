import type { MonarchCategory, MonarchTransaction } from "../monarch/types.ts";
import type { ProposedChange, ProposedSplit } from "../classifier/types.ts";
import type { AppleMatchResult } from "./matcher.ts";
import { loadAppleReceipts } from "./parser.ts";
import { matchAppleTransactions } from "./matcher.ts";
import { computeSplits } from "../classifier/claude.ts";
import { log } from "../logger.ts";

const CATEGORY_RULES: Record<string, string> = {
  icloud: "Software",
  "apple music": "Entertainment & Recreation",
  "apple tv": "Entertainment & Recreation",
  "apple tv+": "Entertainment & Recreation",
  "apple arcade": "Entertainment & Recreation",
  "app store": "Software",
};

function classifyAppleItem(title: string): string {
  const lower = title.toLowerCase();
  for (const [keyword, category] of Object.entries(CATEGORY_RULES)) {
    if (lower.includes(keyword)) return category;
  }
  return "Software";
}

export async function classifyApple(
  appleMailDir: string,
  categories: MonarchCategory[],
  appleTransactions: MonarchTransaction[],
): Promise<{ changes: ProposedChange[]; matchResult: AppleMatchResult }> {
  const receipts = await loadAppleReceipts(appleMailDir);
  const matchResult = matchAppleTransactions(appleTransactions, receipts);
  log.info(
    `Matched ${String(matchResult.matched.length)}/${String(appleTransactions.length)} Apple transactions`,
  );

  const changes: ProposedChange[] = [];

  for (const match of matchResult.matched) {
    const { transaction, receipt } = match;

    if (receipt.items.length === 0) continue;

    const classifiedItems = receipt.items.map((item) => ({
      title: item.title,
      price: item.price,
      category: classifyAppleItem(item.title),
    }));

    const uniqueCategories = new Set(classifiedItems.map((i) => i.category));

    if (uniqueCategories.size > 1 && classifiedItems.length > 1) {
      const splitItems = classifiedItems.map((item) => {
        const cat = categories.find((c) => c.name === item.category);
        return {
          amount: item.price,
          categoryId: cat?.id ?? "",
          itemName: item.title,
          categoryName: item.category,
        };
      });

      const proratedSplits = computeSplits(transaction.amount, splitItems);
      const splits: ProposedSplit[] = proratedSplits.map((s) => ({
        itemName: s.itemName,
        amount: s.amount,
        categoryId: s.categoryId,
        categoryName: s.categoryName,
      }));

      changes.push({
        transactionId: transaction.id,
        transactionDate: transaction.date,
        merchantName: transaction.merchant.name,
        amount: transaction.amount,
        currentCategory: transaction.category.name,
        currentCategoryId: transaction.category.id,
        proposedCategory: "SPLIT",
        proposedCategoryId: "",
        confidence: "high",
        type: "split",
        splits,
      });
    } else {
      const category = classifiedItems[0]?.category ?? "Software";
      const cat = categories.find((c) => c.name === category);
      if (!cat || transaction.category.id === cat.id) continue;

      changes.push({
        transactionId: transaction.id,
        transactionDate: transaction.date,
        merchantName: `Apple: ${classifiedItems[0]?.title ?? "Unknown"}`,
        amount: transaction.amount,
        currentCategory: transaction.category.name,
        currentCategoryId: transaction.category.id,
        proposedCategory: category,
        proposedCategoryId: cat.id,
        confidence: "high",
        type: "recategorize",
      });
    }
  }

  return { changes, matchResult };
}
