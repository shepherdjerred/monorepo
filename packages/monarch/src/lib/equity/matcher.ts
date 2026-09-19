import type { MonarchTransaction } from "../monarch/types.ts";
import type { VestEvent } from "./types.ts";

export type VestMatch = {
  event: VestEvent;
  transactions: MonarchTransaction[];
};

export type VestMatchResult = {
  matched: VestMatch[];
  // A vest date whose Monarch row count differs from the number of awards
  // that released. Worth a look: the brokerage usually books one row per
  // award, so a difference means shares arrived some other way.
  countMismatches: VestMatch[];
  unmatchedEvents: VestEvent[];
  unmatchedTransactions: MonarchTransaction[];
};

// Shares are booked after the vest, never before: Schwab prints the vest date
// and the deposit settles one to three days later. A week covers holiday
// weekends, and vests are quarterly, so nothing else can fall in the window.
const SETTLEMENT_WINDOW_DAYS = 7;

function daysAfter(vestDate: string, transactionDate: string): number {
  return (
    (new Date(transactionDate).getTime() - new Date(vestDate).getTime()) /
    86_400_000
  );
}

export function matchVestEvents(
  transactions: MonarchTransaction[],
  events: VestEvent[],
): VestMatchResult {
  const matched: VestMatch[] = [];
  const countMismatches: VestMatch[] = [];
  const unmatchedEvents: VestEvent[] = [];
  const claimed = new Set<string>();

  // A share deposit moves no cash. Anything with an amount at this merchant is
  // a sale or a dividend, which this export does not describe.
  const eligible = transactions.filter(
    (t) => t.amount === 0 && !t.isSplitTransaction,
  );

  for (const event of events) {
    const rows = eligible.filter((t) => {
      if (claimed.has(t.id)) return false;
      const delta = daysAfter(event.vestDate, t.date);
      return delta >= 0 && delta <= SETTLEMENT_WINDOW_DAYS;
    });
    if (rows.length === 0) {
      unmatchedEvents.push(event);
      continue;
    }
    for (const row of rows) claimed.add(row.id);
    const match = { event, transactions: rows };
    matched.push(match);
    if (rows.length !== event.awards.length) countMismatches.push(match);
  }

  return {
    matched,
    countMismatches,
    unmatchedEvents,
    unmatchedTransactions: eligible.filter((t) => !claimed.has(t.id)),
  };
}

export function vestTotals(event: VestEvent): {
  shares: number;
  grossValue: number;
  sharesWithheld: number;
  netShares: number;
  taxes: number;
} {
  return {
    shares: event.awards.reduce((sum, a) => sum + a.quantity, 0),
    grossValue: event.awards.reduce(
      (sum, a) => sum + a.quantity * a.fairMarketValue,
      0,
    ),
    sharesWithheld: event.awards.reduce(
      (sum, a) => sum + a.sharesWithheldForTaxes,
      0,
    ),
    netShares: event.awards.reduce((sum, a) => sum + a.netSharesDeposited, 0),
    taxes: event.awards.reduce((sum, a) => sum + a.taxes, 0),
  };
}
