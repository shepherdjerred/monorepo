import type { CostcoOrder } from "./types.ts";
import type { MonarchTransaction } from "../monarch/types.ts";

export type CostcoMatch = {
  transaction: MonarchTransaction;
  order: CostcoOrder;
};

export type CostcoMatchResult = {
  matched: CostcoMatch[];
  unmatchedTransactions: MonarchTransaction[];
  unmatchedOrders: CostcoOrder[];
};

export function matchCostcoTransactions(
  monarchTxns: MonarchTransaction[],
  orders: CostcoOrder[],
): CostcoMatchResult {
  const matched: CostcoMatch[] = [];
  const usedOrderIds = new Set<string>();
  const matchedTransactionIds = new Set<string>();

  const eligible = monarchTxns.filter((t) => !t.isSplitTransaction);

  for (const transaction of eligible) {
    const txnAmount = Math.abs(transaction.amount);
    const txnDate = new Date(transaction.date);

    for (const order of orders) {
      if (usedOrderIds.has(order.orderId)) continue;

      const orderDate = new Date(order.date);
      const daysDiff =
        Math.abs(txnDate.getTime() - orderDate.getTime()) /
        (1000 * 60 * 60 * 24);

      if (daysDiff > 5) continue;
      if (Math.abs(txnAmount - order.total) > 1) continue;

      matched.push({ transaction, order });
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
