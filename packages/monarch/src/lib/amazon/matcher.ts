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

type Pairing<T> = {
  transaction: MonarchTransaction;
  candidate: Candidate<T>;
};

function comparePairings<T>(a: Pairing<T>, b: Pairing<T>): number {
  const { candidate: x } = a;
  const { candidate: y } = b;
  if (x.dateDiff !== y.dateDiff) return x.dateDiff - y.dateDiff;
  return x.amountDiff === y.amountDiff
    ? a.transaction.date.localeCompare(b.transaction.date) ||
        x.orderId.localeCompare(y.orderId) ||
        a.transaction.id.localeCompare(b.transaction.id)
    : x.amountDiff - y.amountDiff;
}

// Assign globally rather than one transaction at a time. Taking each
// transaction's local best and consuming it lets an approximate pair steal the
// target of an exact one: with charges on Jan 13 and Jan 15 and transactions
// on Jan 14 and Jan 15, the Jan 14 transaction ties between both charges and
// can take the Jan 15 one, forcing the Jan 15 transaction onto Jan 13 and
// attaching the wrong items to both. Ordering every viable pair by closeness
// and sweeping once settles the exact pairs first.
function assignBestFirst<T>(
  transactions: MonarchTransaction[],
  candidatesFor: (transaction: MonarchTransaction) => Candidate<T>[],
  claim: (pairing: Pairing<T>) => void,
): void {
  const pairings: Pairing<T>[] = [];
  for (const transaction of transactions) {
    for (const candidate of candidatesFor(transaction)) {
      pairings.push({ transaction, candidate });
    }
  }
  pairings.sort(comparePairings);
  for (const pairing of pairings) claim(pairing);
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

  assignBestFirst(
    eligible,
    (transaction) => chargeCandidatesFor(transaction, chargeSlots),
    ({ transaction, candidate }) => {
      if (matchedTransactionIds.has(transaction.id)) return;
      if (candidate.target.used) return;
      candidate.target.used = true;
      chargeMatchedOrderIds.add(candidate.target.order.orderId);
      matchedTransactionIds.add(transaction.id);
      matched.push({
        transaction,
        order: candidate.target.order,
        matchType: "charge",
        items: selectItemsForCharge(
          candidate.target.order,
          candidate.target.charge,
        ),
      });
    },
  );

  // Pass 2: orders without charge data fall back to order-total and
  // single-item-price matching. Orders with charges never fall back — their
  // total is the sum of their charges, so a fallback here would let one
  // order absorb a second transaction.
  const chargelessOrders = orders.filter((o) => o.charges.length === 0);

  assignBestFirst(
    eligible.filter((t) => !matchedTransactionIds.has(t.id)),
    (transaction) =>
      fallbackCandidatesFor(transaction, chargelessOrders, usedOrderIds),
    ({ transaction, candidate }) => {
      if (matchedTransactionIds.has(transaction.id)) return;
      if (usedOrderIds.has(candidate.target.order.orderId)) return;
      usedOrderIds.add(candidate.target.order.orderId);
      matchedTransactionIds.add(transaction.id);
      matched.push({
        transaction,
        order: candidate.target.order,
        matchType: candidate.target.matchType,
        items: candidate.target.order.items,
      });
    },
  );

  // Best-first assignment produces matches in closeness order; restore
  // transaction order so downstream output reads chronologically.
  matched.sort((a, b) => a.transaction.date.localeCompare(b.transaction.date));

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
