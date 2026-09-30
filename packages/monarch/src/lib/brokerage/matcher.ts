import type { MonarchTransaction } from "../monarch/types.ts";
import type { CashEvent, FundedEvent, ShareSale } from "./types.ts";

export type BrokerageMatch = {
  transaction: MonarchTransaction;
  funded: FundedEvent;
};

export type BrokerageMatchResult = {
  matched: BrokerageMatch[];
  unmatchedTransactions: MonarchTransaction[];
  unmatchedEvents: CashEvent[];
};

// A sale settles before its proceeds can leave, and the sweep follows within a
// day or two. Measured across all seven sales: the transfer landed one to four
// days after the trade, every time.
const SETTLEMENT_WINDOW_DAYS = 5;
// A transfer empties the account, so it carries the proceeds plus whatever
// idle cash was sitting there. Measured: the 2025-05-13 transfer exceeded its
// sale by $0.12, the credit interest posted that February. Beyond a dollar the
// pairing is not a sweep and is left unexplained rather than guessed at.
const MAX_CASH_SWEPT = 1;
// The bank posts the broker's own figure, so it agrees exactly.
const AMOUNT_TOLERANCE = 0.005;
// ACH from the broker posts the same day in this account's history; the window
// only guards against a weekend.
const POSTING_WINDOW_DAYS = 3;

function daysBetween(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000;
}

// The sale that funded a transfer: the most recent one whose proceeds explain
// the amount that left. Interest is never funded by a sale.
export function fundEvent(event: CashEvent, sales: ShareSale[]): FundedEvent {
  if (event.kind !== "transfer") {
    return { event, sale: undefined, cashSwept: 0 };
  }

  let best: ShareSale | undefined;
  for (const sale of sales) {
    const delay = daysBetween(sale.soldDate, event.date);
    if (delay < 0 || delay > SETTLEMENT_WINDOW_DAYS) continue;
    const swept = event.amount - sale.proceeds;
    if (swept < -AMOUNT_TOLERANCE || swept > MAX_CASH_SWEPT) continue;
    // Nearest preceding sale, so a same-week pair cannot reach past one.
    if (
      best === undefined ||
      daysBetween(sale.soldDate, event.date) <
        daysBetween(best.soldDate, event.date)
    ) {
      best = sale;
    }
  }

  return {
    event,
    sale: best,
    cashSwept: best === undefined ? 0 : event.amount - best.proceeds,
  };
}

export function matchBrokerageTransactions(
  transactions: MonarchTransaction[],
  events: CashEvent[],
  sales: ShareSale[],
): BrokerageMatchResult {
  const matched: BrokerageMatch[] = [];
  const claimedEvents = new Set<CashEvent>();
  const matchedIds = new Set<string>();

  // Money arriving from the brokerage. A charge at this merchant would be a
  // different kind of event entirely and this export does not describe it.
  const eligible = transactions
    .filter((t) => !t.isSplitTransaction && t.amount > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const transaction of eligible) {
    const candidates = events.filter((event) => {
      if (claimedEvents.has(event)) return false;
      if (Math.abs(event.amount - transaction.amount) > AMOUNT_TOLERANCE) {
        return false;
      }
      const delay = daysBetween(event.date, transaction.date);
      return delay >= 0 && delay <= POSTING_WINDOW_DAYS;
    });
    // Two identical amounts in one window cannot be told apart from the bank
    // row, and attaching the wrong sale would state the wrong gain.
    if (candidates.length !== 1) continue;

    const event = candidates[0];
    if (event === undefined) continue;
    claimedEvents.add(event);
    matchedIds.add(transaction.id);
    matched.push({ transaction, funded: fundEvent(event, sales) });
  }

  return {
    matched,
    unmatchedTransactions: eligible.filter((t) => !matchedIds.has(t.id)),
    unmatchedEvents: events.filter((e) => !claimedEvents.has(e)),
  };
}
