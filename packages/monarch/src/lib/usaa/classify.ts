import type { MonarchCategory, MonarchTransaction } from "../monarch/types.ts";
import type { ProposedChange, ProposedSplit } from "../classifier/types.ts";
import { matchUsaaTransactions, buildUsaaSplits } from "./matcher.ts";
import { log } from "../logger.ts";

export function classifyUsaa(
  categories: MonarchCategory[],
  usaaTransactions: MonarchTransaction[],
): ProposedChange[] {
  const { matched, unmatchedTransactions } = matchUsaaTransactions(usaaTransactions);
  log.info(`Matched ${String(matched.length)}/${String(usaaTransactions.length)} USAA transactions`);

  if (unmatchedTransactions.length > 0) {
    log.info(`Unmatched USAA transactions: ${String(unmatchedTransactions.length)}`);
  }

  const insuranceCat = categories.find((c) => c.name === "Insurance");
  if (!insuranceCat) {
    log.info("Insurance category not found, skipping USAA splits");
    return [];
  }

  const changes: ProposedChange[] = [];

  for (const match of matched) {
    const splits = buildUsaaSplits(match.statement);
    const proposedSplits: ProposedSplit[] = splits.map((s, i) => ({
      itemName: i === 0 ? "Auto Insurance" : "Renters Insurance",
      amount: s.amount,
      categoryId: insuranceCat.id,
      categoryName: "Insurance",
    }));

    changes.push({
      transactionId: match.monarchTransactionId,
      transactionDate: match.monarchDate,
      merchantName: "USAA",
      amount: match.monarchAmount,
      currentCategory: "Insurance",
      currentCategoryId: insuranceCat.id,
      proposedCategory: "SPLIT",
      proposedCategoryId: "",
      confidence: "high",
      type: "split",
      splits: proposedSplits,
    });
  }

  return changes;
}
