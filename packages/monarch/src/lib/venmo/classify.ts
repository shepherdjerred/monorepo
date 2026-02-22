import type { Config } from "../config.ts";
import type { MonarchCategory, MonarchTransaction } from "../monarch/types.ts";
import type { ProposedChange } from "../classifier/types.ts";
import type { VenmoMatchResult } from "./matcher.ts";
import { classifyVenmoPayments } from "../classifier/claude.ts";
import { parseVenmoCSV } from "./parser.ts";
import { matchVenmoTransactions } from "./matcher.ts";
import { log } from "../logger.ts";

export async function classifyVenmo(
  config: Config,
  categories: MonarchCategory[],
  venmoTransactions: MonarchTransaction[],
): Promise<{ changes: ProposedChange[]; matchResult: VenmoMatchResult | null }> {
  if (config.venmoCsv === undefined) {
    return { changes: [], matchResult: null };
  }

  const venmoTxns = await parseVenmoCSV(config.venmoCsv);
  log.info(`Parsed ${String(venmoTxns.length)} Venmo payments`);

  const matchResult = matchVenmoTransactions(venmoTransactions, venmoTxns);
  log.info(
    `Matched ${String(matchResult.matched.length)}/${String(venmoTransactions.length)} Venmo transactions`,
  );

  if (matchResult.matched.length === 0) {
    return { changes: [], matchResult };
  }

  const classification = await classifyVenmoPayments(categories, matchResult.matched);
  const changes: ProposedChange[] = [];

  for (const payment of classification.payments) {
    const match = matchResult.matched.find(
      (m) =>
        m.venmoTransaction.note === payment.note &&
        Math.abs(Math.abs(m.venmoTransaction.amount) - payment.amount) < 0.01,
    );
    if (!match) continue;

    const direction = match.venmoTransaction.amount > 0 ? "from" : "to";
    const other = match.venmoTransaction.amount > 0
      ? match.venmoTransaction.from
      : match.venmoTransaction.to;

    changes.push({
      transactionId: match.transaction.id,
      transactionDate: match.transaction.date,
      merchantName: `Venmo ${direction} ${other}: ${match.venmoTransaction.note}`,
      amount: match.transaction.amount,
      currentCategory: match.transaction.category.name,
      currentCategoryId: match.transaction.category.id,
      proposedCategory: payment.categoryName,
      proposedCategoryId: payment.categoryId,
      confidence: payment.confidence,
      type: "recategorize",
    });
  }

  return { changes, matchResult };
}
