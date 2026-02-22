import type { ProposedChange } from "./classifier/types.ts";

export type ResolvedTransaction = {
  transactionId: string;
  category: string;
  detail?: string;
};

export function buildResolvedMap(
  changes: ProposedChange[],
): Map<string, ResolvedTransaction> {
  const map = new Map<string, ResolvedTransaction>();

  for (const change of changes) {
    if (change.type === "split" && change.splits !== undefined) {
      const detail = change.splits
        .map((s) => `${s.itemName} → ${s.categoryName}`)
        .join(", ");
      map.set(change.transactionId, {
        transactionId: change.transactionId,
        category: "SPLIT",
        detail,
      });
    } else {
      map.set(change.transactionId, {
        transactionId: change.transactionId,
        category: change.proposedCategory,
      });
    }
  }

  return map;
}
