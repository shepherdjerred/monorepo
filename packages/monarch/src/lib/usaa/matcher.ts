import type { MonarchTransaction } from "../monarch/types.ts";
import type { UsaaStatement, UsaaMatch } from "./types.ts";
import { USAA_STATEMENTS } from "./data.ts";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export type UsaaSplit = {
  category: string;
  amount: number;
};

export type UsaaMatchResult = {
  matched: UsaaMatch[];
  unmatchedTransactions: MonarchTransaction[];
};

export function matchUsaaTransactions(
  monarchTxns: MonarchTransaction[],
): UsaaMatchResult {
  const matched: UsaaMatch[] = [];
  const matchedTxnIds = new Set<string>();
  const usedStatements = new Set<string>();

  const eligible = monarchTxns.filter((t) => !t.isSplitTransaction);

  for (const txn of eligible) {
    const txnAmount = Math.abs(txn.amount);
    const txnDate = new Date(txn.date);

    for (const statement of USAA_STATEMENTS) {
      if (usedStatements.has(statement.draftDate)) continue;

      const draftDate = new Date(statement.draftDate);
      const daysDiff = Math.abs(txnDate.getTime() - draftDate.getTime()) / MS_PER_DAY;

      if (daysDiff > 3) continue;
      if (Math.abs(txnAmount - statement.totalAmount) > 0.02) continue;

      matched.push({
        monarchTransactionId: txn.id,
        monarchDate: txn.date,
        monarchAmount: txn.amount,
        statement,
      });
      matchedTxnIds.add(txn.id);
      usedStatements.add(statement.draftDate);
      break;
    }
  }

  const unmatchedTransactions = eligible.filter((t) => !matchedTxnIds.has(t.id));
  return { matched, unmatchedTransactions };
}

export function buildUsaaSplits(statement: UsaaStatement): UsaaSplit[] {
  const { totalAmount, autoAmount, rentersAmount } = statement;
  const policyTotal = autoAmount + rentersAmount;
  const remainder = totalAmount - policyTotal;

  if (remainder < 0.01) {
    return [
      { category: "Insurance", amount: autoAmount },
      { category: "Insurance", amount: rentersAmount },
    ];
  }

  // Allocate remainder (past due + late fees) proportionally
  const autoRatio = autoAmount / policyTotal;
  const allocatedAuto = autoAmount + remainder * autoRatio;
  const allocatedRenters = totalAmount - allocatedAuto;

  return [
    { category: "Insurance", amount: Math.round(allocatedAuto * 100) / 100 },
    { category: "Insurance", amount: Math.round(allocatedRenters * 100) / 100 },
  ];
}
