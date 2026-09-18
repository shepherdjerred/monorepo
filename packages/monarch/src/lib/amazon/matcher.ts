import type { AmazonOrder, AmazonItem, AmazonCharge } from "./types.ts";
import type { MonarchTransaction } from "../monarch/types.ts";

export type MatchedTransaction = {
  transaction: MonarchTransaction;
  order: AmazonOrder;
  matchType: "charge" | "order-total" | "item-price";
  items: AmazonItem[];
};

export type MatchResult = {
  matched: MatchedTransaction[];
  unmatchedTransactions: MonarchTransaction[];
  unmatchedOrders: AmazonOrder[];
};

const AMOUNT_TOLERANCE = 0.02;
const DATE_WINDOW_DAYS = 3;
// WA sales tax band used to attribute a partial-shipment charge to the item
// subset it covers: charge = subset subtotal + prorated tax.
const MAX_TAX_RATIO = 1.115;

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000;
}

type ChargeSlot = {
  order: AmazonOrder;
  charge: AmazonCharge;
  used: boolean;
};

type Candidate<T> = {
  target: T;
  dateDiff: number;
  amountDiff: number;
  orderId: string;
};

function isBetter<T>(c: Candidate<T>, best: Candidate<T>): boolean {
  if (c.dateDiff !== best.dateDiff) return c.dateDiff < best.dateDiff;
  if (c.amountDiff !== best.amountDiff) return c.amountDiff < best.amountDiff;
  return c.orderId < best.orderId;
}

function pickBest<T>(candidates: Candidate<T>[]): Candidate<T> | undefined {
  let best: Candidate<T> | undefined;
  for (const c of candidates) {
    if (best === undefined || isBetter(c, best)) best = c;
  }
  return best;
}

// A Monarch expense is negative and pairs with a positive charge; a positive
// transaction is a refund and pairs with a negative charge.
function chargeCandidatesFor(
  transaction: MonarchTransaction,
  chargeSlots: ChargeSlot[],
): Candidate<ChargeSlot>[] {
  const txnAmount = Math.abs(transaction.amount);
  const candidates: Candidate<ChargeSlot>[] = [];
  for (const slot of chargeSlots) {
    if (slot.used) continue;
    const signCompatible =
      (transaction.amount < 0 && slot.charge.amount > 0) ||
      (transaction.amount > 0 && slot.charge.amount < 0);
    if (!signCompatible) continue;

    const amountDiff = Math.abs(txnAmount - Math.abs(slot.charge.amount));
    if (amountDiff > AMOUNT_TOLERANCE) continue;

    const dateDiff = daysBetween(transaction.date, slot.charge.date);
    if (dateDiff > DATE_WINDOW_DAYS) continue;

    candidates.push({
      target: slot,
      dateDiff,
      amountDiff,
      orderId: slot.order.orderId,
    });
  }
  return candidates;
}

type FallbackTarget = {
  order: AmazonOrder;
  matchType: "order-total" | "item-price";
};

function fallbackCandidatesFor(
  transaction: MonarchTransaction,
  chargelessOrders: AmazonOrder[],
  usedOrderIds: Set<string>,
): Candidate<FallbackTarget>[] {
  const txnAmount = Math.abs(transaction.amount);
  const candidates: Candidate<FallbackTarget>[] = [];
  for (const order of chargelessOrders) {
    if (usedOrderIds.has(order.orderId)) continue;

    const dateDiff = daysBetween(transaction.date, order.date);
    if (dateDiff > DATE_WINDOW_DAYS) continue;

    const totalDiff = Math.abs(txnAmount - order.total);
    if (totalDiff <= AMOUNT_TOLERANCE) {
      candidates.push({
        target: { order, matchType: "order-total" },
        dateDiff,
        amountDiff: totalDiff,
        orderId: order.orderId,
      });
      continue;
    }

    if (order.items.length === 1) {
      const itemDiff = Math.abs(txnAmount - (order.items[0]?.price ?? 0));
      if (itemDiff <= AMOUNT_TOLERANCE) {
        candidates.push({
          target: { order, matchType: "item-price" },
          dateDiff,
          amountDiff: itemDiff,
          orderId: order.orderId,
        });
      }
    }
  }
  return candidates;
}

export function matchAmazonOrders(
  transactions: MonarchTransaction[],
  orders: AmazonOrder[],
): MatchResult {
  const matched: MatchedTransaction[] = [];
  const matchedTransactionIds = new Set<string>();
  const usedOrderIds = new Set<string>();
  const chargeMatchedOrderIds = new Set<string>();

  const eligible = transactions
    .filter((t) => !t.isSplitTransaction)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Pass 1: match against individual card charges, consuming each charge
  // once — a split-shipment order can be matched by several transactions.
  const chargeSlots: ChargeSlot[] = orders.flatMap((order) =>
    order.charges.map((charge) => ({ order, charge, used: false })),
  );

  for (const transaction of eligible) {
    const best = pickBest(chargeCandidatesFor(transaction, chargeSlots));
    if (!best) continue;

    best.target.used = true;
    chargeMatchedOrderIds.add(best.target.order.orderId);
    matchedTransactionIds.add(transaction.id);
    matched.push({
      transaction,
      order: best.target.order,
      matchType: "charge",
      items: selectItemsForCharge(best.target.order, best.target.charge),
    });
  }

  // Pass 2: orders without charge data fall back to order-total and
  // single-item-price matching. Orders with charges never fall back — their
  // total is the sum of their charges, so a fallback here would let one
  // order absorb a second transaction.
  const chargelessOrders = orders.filter((o) => o.charges.length === 0);

  for (const transaction of eligible) {
    if (matchedTransactionIds.has(transaction.id)) continue;
    const best = pickBest(
      fallbackCandidatesFor(transaction, chargelessOrders, usedOrderIds),
    );
    if (!best) continue;

    usedOrderIds.add(best.target.order.orderId);
    matchedTransactionIds.add(transaction.id);
    matched.push({
      transaction,
      order: best.target.order,
      matchType: best.target.matchType,
      items: best.target.order.items,
    });
  }

  const unmatchedTransactions = eligible.filter(
    (t) => !matchedTransactionIds.has(t.id),
  );
  const unmatchedOrders = orders.filter(
    (o) =>
      !usedOrderIds.has(o.orderId) && !chargeMatchedOrderIds.has(o.orderId),
  );

  return { matched, unmatchedTransactions, unmatchedOrders };
}

function subsetQualifies(sum: number, amount: number): boolean {
  return (
    sum - AMOUNT_TOLERANCE <= amount &&
    amount <= sum * MAX_TAX_RATIO + AMOUNT_TOLERANCE
  );
}

// A partial-shipment charge covers a subset of the order's items plus
// prorated tax. Attaching only that subset keeps computeSplits proration
// over the right items; when the subset is ambiguous the full list is the
// accepted status quo.
export function selectItemsForCharge(
  order: AmazonOrder,
  charge: AmazonCharge,
): AmazonItem[] {
  const amount = Math.abs(charge.amount);
  if (Math.abs(amount - order.total) <= AMOUNT_TOLERANCE) return order.items;
  if (order.items.length === 0 || order.items.length > 12) return order.items;

  let qualifying: AmazonItem[] | undefined;
  for (let mask = 1; mask < 1 << order.items.length; mask++) {
    const subset = subsetForMask(order.items, mask);
    const sum = subset.reduce((total, item) => total + item.price, 0);
    if (subsetQualifies(sum, amount)) {
      if (qualifying !== undefined) return order.items;
      qualifying = subset;
    }
  }

  return qualifying ?? order.items;
}

function subsetForMask(items: AmazonItem[], mask: number): AmazonItem[] {
  return items.filter((_, i) => (mask & (1 << i)) !== 0);
}
