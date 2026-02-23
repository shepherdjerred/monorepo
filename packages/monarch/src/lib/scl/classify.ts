import type { MonarchCategory, MonarchTransaction } from "../monarch/types.ts";
import type { ProposedChange } from "../classifier/types.ts";
import { parseSclCSV } from "./parser.ts";
import { matchSclTransactions } from "./matcher.ts";
import { log } from "../logger.ts";

function priorMonthDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const month = date.getMonth();
  const year = date.getFullYear();
  if (month === 0) {
    date.setFullYear(year - 1);
    date.setMonth(11);
  } else {
    date.setMonth(month - 1);
  }
  return date.toISOString().split("T")[0] ?? "";
}

export async function classifyScl(
  sclCsvPath: string,
  categories: MonarchCategory[],
  sclTransactions: MonarchTransaction[],
): Promise<ProposedChange[]> {
  const text = await Bun.file(sclCsvPath).text();
  const bills = parseSclCSV(text);

  const { matched } = matchSclTransactions(sclTransactions, bills);
  log.info(
    `Matched ${String(matched.length)}/${String(sclTransactions.length)} Seattle City Light transactions`,
  );

  const electricCat = categories.find((c) => c.name === "Gas & Electric");
  if (!electricCat) {
    log.info("Gas & Electric category not found, skipping SCL classification");
    return [];
  }

  const changes: ProposedChange[] = [];

  for (const match of matched) {
    const txn = match.transaction;
    const halfAmount = Math.round((Math.abs(txn.amount) * 100) / 2) / 100;
    const remainder = Math.round(Math.abs(txn.amount) * 100) / 100 - halfAmount;
    const priorDate = priorMonthDate(txn.date);

    changes.push({
      transactionId: txn.id,
      transactionDate: txn.date,
      merchantName: "Seattle City Light",
      amount: txn.amount,
      currentCategory: txn.category.name,
      currentCategoryId: txn.category.id,
      proposedCategory: "Gas & Electric",
      proposedCategoryId: electricCat.id,
      confidence: "high",
      type: "split",
      splits: [
        {
          itemName: "SCL Electric (current month)",
          amount: halfAmount,
          categoryId: electricCat.id,
          categoryName: "Gas & Electric",
        },
        {
          itemName: "SCL Electric (prior month)",
          amount: remainder,
          categoryId: electricCat.id,
          categoryName: "Gas & Electric",
          date: priorDate,
        },
      ],
    });
  }

  return changes;
}
