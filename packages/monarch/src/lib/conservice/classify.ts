import type { Config } from "../config.ts";
import type { MonarchCategory, MonarchTransaction } from "../monarch/types.ts";
import type { ProposedChange, ProposedSplit } from "../classifier/types.ts";
import type { BiltMatch } from "./types.ts";
import { fetchConserviceCharges } from "./client.ts";
import { groupByMonth, matchBiltTransactions } from "./matcher.ts";
import { log } from "../logger.ts";

function buildBiltSplitChange(
  match: BiltMatch,
  categories: MonarchCategory[],
): ProposedChange | undefined {
  const splits: ProposedSplit[] = [];
  for (const s of match.splits) {
    const cat = categories.find((c) => c.name === s.category);
    if (!cat) continue;
    splits.push({
      itemName: s.category,
      amount: s.amount,
      categoryId: cat.id,
      categoryName: s.category,
    });
  }

  if (splits.length === 0) return undefined;

  return {
    transactionId: match.monarchTransaction.id,
    transactionDate: match.monarchTransaction.date,
    merchantName: "Bilt",
    amount: match.monarchTransaction.amount,
    currentCategory: match.monarchTransaction.category.name,
    currentCategoryId: match.monarchTransaction.category.id,
    proposedCategory: "SPLIT",
    proposedCategoryId: "",
    confidence: "high",
    type: "split",
    splits,
  };
}

function buildBiltRecategorizeChange(
  match: BiltMatch,
  categories: MonarchCategory[],
): ProposedChange | undefined {
  const split = match.splits[0];
  if (!split) return undefined;

  const cat = categories.find((c) => c.name === split.category);
  if (!cat) return undefined;

  return {
    transactionId: match.monarchTransaction.id,
    transactionDate: match.monarchTransaction.date,
    merchantName: "Bilt",
    amount: match.monarchTransaction.amount,
    currentCategory: match.monarchTransaction.category.name,
    currentCategoryId: match.monarchTransaction.category.id,
    proposedCategory: split.category,
    proposedCategoryId: cat.id,
    confidence: "high",
    type: "recategorize",
  };
}

export async function classifyBilt(
  config: Config,
  categories: MonarchCategory[],
  biltTransactions: MonarchTransaction[],
): Promise<{ changes: ProposedChange[]; matches: BiltMatch[] }> {
  if (config.conserviceCookies === undefined) {
    return { changes: [], matches: [] };
  }

  const charges = await fetchConserviceCharges(config.conserviceCookies);
  log.info(`Fetched ${String(charges.length)} Conservice charges`);

  const months = groupByMonth(charges);
  log.info(`Grouped into ${String(months.length)} monthly summaries`);

  const matches = matchBiltTransactions(biltTransactions, months);
  log.info(`Matched ${String(matches.length)}/${String(biltTransactions.length)} Bilt transactions`);

  const changes: ProposedChange[] = [];

  for (const match of matches) {
    const change = match.splits.length <= 1
      ? buildBiltRecategorizeChange(match, categories)
      : buildBiltSplitChange(match, categories);
    if (change) changes.push(change);
  }

  return { changes, matches };
}
