import type { AmazonOrder } from "./types.ts";
import type { MonarchTransaction } from "../monarch/types.ts";

export type MatchedTransaction = {
  transaction: MonarchTransaction;
  order: AmazonOrder;
  matchType: "exact" | "fuzzy";
};

export type MatchResult = {
  matched: MatchedTransaction[];
  unmatchedTransactions: MonarchTransaction[];
  unmatchedOrders: AmazonOrder[];
};

export function matchAmazonOrders(
  transactions: MonarchTransaction[],
  orders: AmazonOrder[],
): MatchResult {
  const matched: MatchedTransaction[] = [];
  const usedOrderIds = new Set<string>();
  const matchedTransactionIds = new Set<string>();

  const eligible = transactions.filter((t) => !t.isSplitTransaction);

  for (const transaction of eligible) {
    const txnAmount = Math.abs(transaction.amount);
    const txnDate = new Date(transaction.date);

    for (const order of orders) {
      if (usedOrderIds.has(order.orderId)) continue;

      const orderDate = new Date(order.date);
      const daysDiff = Math.abs(txnDate.getTime() - orderDate.getTime()) / (1000 * 60 * 60 * 24);

      if (daysDiff > 3) continue;

      const amountMatch = isAmountMatch(txnAmount, order);
      if (!amountMatch) continue;

      matched.push({
        transaction,
        order,
        matchType: "exact",
      });
      usedOrderIds.add(order.orderId);
      matchedTransactionIds.add(transaction.id);
      break;
    }
  }

  const unmatchedTransactions = eligible.filter(
    (t) => !matchedTransactionIds.has(t.id),
  );
  const unmatchedOrders = orders.filter(
    (o) => !usedOrderIds.has(o.orderId),
  );

  return { matched, unmatchedTransactions, unmatchedOrders };
}

function isAmountMatch(txnAmount: number, order: AmazonOrder): boolean {
  if (Math.abs(txnAmount - order.total) <= 0.02) {
    return true;
  }

  if (order.items.length === 1) {
    const itemPrice = order.items[0]?.price ?? 0;
    if (Math.abs(txnAmount - itemPrice) <= 0.02) {
      return true;
    }
  }

  return false;
}
