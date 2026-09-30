import { describe, expect, test } from "vitest";
import { matchVestEvents, vestTotals } from "./matcher.ts";
import type { VestAward, VestEvent } from "./types.ts";
import type { MonarchTransaction } from "../monarch/types.ts";

function award(
  quantity: number,
  overrides: Partial<VestAward> = {},
): VestAward {
  return {
    awardDate: "2024-10-10",
    awardId: "200947983",
    quantity,
    fairMarketValue: 20,
    sharesWithheldForTaxes: Math.round(quantity * 0.45),
    netSharesDeposited: quantity - Math.round(quantity * 0.45),
    taxes: quantity * 20 * 0.45,
    ...overrides,
  };
}

function event(vestDate: string, awards: VestAward[]): VestEvent {
  return { vestDate, symbol: "PINS", awards };
}

function lapseRow(
  date: string,
  index = 0,
  overrides: Partial<MonarchTransaction> = {},
): MonarchTransaction {
  return {
    id: `t-${date}-${String(index)}`,
    amount: 0,
    pending: false,
    date,
    hideFromReports: false,
    plaidName: "PINTEREST INC CLASS A",
    notes: "",
    isRecurring: false,
    reviewStatus: "none",
    needsReview: false,
    isSplitTransaction: false,
    createdAt: date,
    updatedAt: date,
    category: { id: "c", name: "Dividends & Capital Gains" },
    merchant: { id: "m", name: "Pinterest Inc Class A", transactionsCount: 1 },
    account: { id: "a", displayName: "Individual ...284" },
    tags: [],
    ...overrides,
  };
}

describe("matchVestEvents", () => {
  test("claims every settlement row that follows a vest date", () => {
    const result = matchVestEvents(
      [lapseRow("2026-06-22", 0), lapseRow("2026-06-22", 1)],
      [event("2026-06-20", [award(711), award(213)])],
    );
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]?.transactions).toHaveLength(2);
    expect(result.countMismatches).toHaveLength(0);
  });

  test("does not reach backwards: shares settle after the vest", () => {
    const result = matchVestEvents(
      [lapseRow("2026-06-19")],
      [event("2026-06-20", [award(711)])],
    );
    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedEvents).toHaveLength(1);
    expect(result.unmatchedTransactions).toHaveLength(1);
  });

  test("keeps quarterly vests apart", () => {
    const result = matchVestEvents(
      [lapseRow("2026-03-23"), lapseRow("2026-06-22")],
      [event("2026-03-20", [award(213)]), event("2026-06-20", [award(711)])],
    );
    expect(result.matched).toHaveLength(2);
    expect(result.matched[0]?.transactions[0]?.date).toBe("2026-03-23");
    expect(result.matched[1]?.transactions[0]?.date).toBe("2026-06-22");
  });

  test("a row count that disagrees with the award count is surfaced", () => {
    const result = matchVestEvents(
      [lapseRow("2026-06-22")],
      [event("2026-06-20", [award(711), award(213)])],
    );
    expect(result.matched).toHaveLength(1);
    expect(result.countMismatches).toHaveLength(1);
  });

  test("ignores rows that moved cash", () => {
    const result = matchVestEvents(
      [lapseRow("2026-06-22", 0, { amount: 25_000 })],
      [event("2026-06-20", [award(711)])],
    );
    expect(result.matched).toHaveLength(0);
  });
});

describe("vestTotals", () => {
  test("adds up the awards released that day", () => {
    const totals = vestTotals(
      event("2026-06-20", [
        award(711, {
          fairMarketValue: 20.27,
          sharesWithheldForTaxes: 324,
          netSharesDeposited: 387,
          taxes: 6567.48,
        }),
        award(213, {
          fairMarketValue: 20.27,
          sharesWithheldForTaxes: 97,
          netSharesDeposited: 116,
          taxes: 1966.19,
        }),
      ]),
    );
    expect(totals.shares).toBe(924);
    expect(totals.grossValue).toBeCloseTo(18_729.48, 2);
    expect(totals.sharesWithheld).toBe(421);
    expect(totals.netShares).toBe(503);
    expect(totals.taxes).toBeCloseTo(8533.67, 2);
  });
});
