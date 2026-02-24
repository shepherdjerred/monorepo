import type { MonarchTransaction } from "../monarch/types.ts";
import type { TransactionEnrichment, Tier } from "./types.ts";
import type { MerchantKnowledge } from "../knowledge/types.ts";

// Cryptic merchant name patterns that suggest tier 3
const CRYPTIC_PATTERNS = [
  /^SQ \*/i,
  /^TST\*/i,
  /^SP \*/i,
  /^PAY\*/i,
  /^CKE\*/i,
  /^PP\*/i,
];

function isCrypticMerchant(name: string): boolean {
  return CRYPTIC_PATTERNS.some((p) => p.test(name));
}

export function assignTier(
  txn: MonarchTransaction,
  enrichment: TransactionEnrichment | undefined,
  knowledgeBase: Map<string, MerchantKnowledge>,
): Tier {
  const merchantLower = txn.merchant.name.toLowerCase();
  const kb = knowledgeBase.get(merchantLower);

  // Tier 1: Single-category merchant in KB with high confidence, no conflicting enrichment
  if (kb && !kb.multiCategory && kb.defaultCategory && kb.confidence === "high") {
    // If enrichment suggests something different, bump to tier 2
    if (enrichment) {
      return 2;
    }
    return 1;
  }

  // Tier 3: Cryptic merchant name with no KB and no enrichment
  if (!kb && !enrichment && isCrypticMerchant(txn.merchant.name)) {
    return 3;
  }

  // Tier 3: Unknown merchant with no enrichment and no KB
  if (!kb && !enrichment && txn.merchant.name.length <= 3) {
    return 3;
  }

  // Tier 2: Has enrichment data or is a recognizable merchant (even without KB)
  if (enrichment) {
    return 2;
  }

  // Tier 2: KB exists (multi-category or lower confidence)
  if (kb) {
    return 2;
  }

  // Default: Tier 2 for most recognizable merchants
  // Tier 3 only for truly unknown/cryptic ones
  if (isCrypticMerchant(txn.merchant.name)) {
    return 3;
  }

  return 2;
}
