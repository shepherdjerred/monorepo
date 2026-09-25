import type { MonarchTransaction } from "./monarch/types.ts";
import { log } from "./logger.ts";

// Takes the first N distinct merchants encountered, then every transaction
// from those merchants — a merchant-shaped slice reads more like production
// than the first N transactions, which tend to cluster on one recurring payee.
export function sampleByMerchant(
  transactions: MonarchTransaction[],
  sampleSize: number,
): MonarchTransaction[] {
  const sampledMerchants = new Set<string>();
  for (const txn of transactions) {
    if (sampledMerchants.size >= sampleSize) break;
    sampledMerchants.add(txn.merchant.name);
  }
  const sampled = transactions.filter((txn) =>
    sampledMerchants.has(txn.merchant.name),
  );
  log.info(
    `Sampled ${String(sampledMerchants.size)} merchant groups, ${String(sampled.length)} transactions`,
  );
  return sampled;
}
