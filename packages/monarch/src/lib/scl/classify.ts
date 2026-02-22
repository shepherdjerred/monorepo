import type { MonarchCategory, MonarchTransaction } from "../monarch/types.ts";
import type { ProposedChange } from "../classifier/types.ts";
import { parseSclCSV } from "./parser.ts";
import { matchSclTransactions } from "./matcher.ts";
import { log } from "../logger.ts";

export async function classifyScl(
  sclCsvPath: string,
  categories: MonarchCategory[],
  sclTransactions: MonarchTransaction[],
): Promise<ProposedChange[]> {
  const text = await Bun.file(sclCsvPath).text();
  const bills = parseSclCSV(text);

  const { matched } = matchSclTransactions(sclTransactions, bills);
  log.info(`Matched ${String(matched.length)}/${String(sclTransactions.length)} Seattle City Light transactions`);

  const electricCat = categories.find((c) => c.name === "Gas & Electric");
  if (!electricCat) {
    log.info("Gas & Electric category not found, skipping SCL recategorization");
    return [];
  }

  const changes: ProposedChange[] = [];

  for (const match of matched) {
    if (match.transaction.category.name === "Gas & Electric") continue;

    changes.push({
      transactionId: match.transaction.id,
      transactionDate: match.transaction.date,
      merchantName: "Seattle City Light",
      amount: match.transaction.amount,
      currentCategory: match.transaction.category.name,
      currentCategoryId: match.transaction.category.id,
      proposedCategory: "Gas & Electric",
      proposedCategoryId: electricCat.id,
      confidence: "high",
      type: "recategorize",
    });
  }

  return changes;
}
