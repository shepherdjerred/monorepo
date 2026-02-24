import type { EnrichedTransaction } from "../enrichment/types.ts";
import type { ProposedChange } from "./types.ts";
import { lookupMerchant } from "../knowledge/store.ts";
import type { MerchantKnowledge } from "../knowledge/types.ts";
import { log } from "../logger.ts";

export function classifyTier1(
  transactions: EnrichedTransaction[],
  knowledgeBase: Map<string, MerchantKnowledge>,
): ProposedChange[] {
  const changes: ProposedChange[] = [];

  for (const enriched of transactions) {
    const { transaction: txn } = enriched;
    const kb = lookupMerchant(knowledgeBase, txn.merchant.name);

    if (!kb?.defaultCategory) continue;

    // Only propose a change if the current category differs
    if (txn.category.id === kb.defaultCategory.id) continue;

    changes.push({
      transactionId: txn.id,
      transactionDate: txn.date,
      merchantName: txn.merchant.name,
      amount: txn.amount,
      currentCategory: txn.category.name,
      currentCategoryId: txn.category.id,
      proposedCategory: kb.defaultCategory.name,
      proposedCategoryId: kb.defaultCategory.id,
      confidence: kb.confidence,
      type: "recategorize",
      tier: 1,
    });
  }

  log.info(
    `Tier 1: ${String(changes.length)} changes from ${String(transactions.length)} transactions`,
  );

  return changes;
}
