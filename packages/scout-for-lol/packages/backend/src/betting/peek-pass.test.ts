import { describe, expect, test } from "bun:test";
import { calculatePeekPassPrice } from "#src/betting/peek-pass.ts";

const NOW = new Date("2026-08-19T00:00:00Z");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function weeksAgo(weeks: number): Date {
  return new Date(NOW.getTime() - weeks * WEEK_MS);
}

describe("calculatePeekPassPrice", () => {
  test("ages only the FIFO lots that remain after debits", () => {
    const result = calculatePeekPassPrice({
      balance: 100,
      now: NOW,
      ledger: [
        { id: 1, delta: 100, balanceAfter: 100, createdAt: weeksAgo(8) },
        { id: 2, delta: 100, balanceAfter: 200, createdAt: weeksAgo(2) },
        { id: 3, delta: -100, balanceAfter: 100, createdAt: weeksAgo(1) },
      ],
    });
    expect(result).toEqual({
      balance: 100,
      weightedAgeWeeks: 2,
      price: 12,
    });
  });

  test("uses weighted full weeks, percentage steps, and the 25% cap", () => {
    const weighted = calculatePeekPassPrice({
      balance: 100,
      now: NOW,
      ledger: [
        { id: 1, delta: 50, balanceAfter: 50, createdAt: weeksAgo(8) },
        { id: 2, delta: 50, balanceAfter: 100, createdAt: weeksAgo(2) },
      ],
    });
    const capped = calculatePeekPassPrice({
      balance: 100,
      now: NOW,
      ledger: [
        { id: 1, delta: 100, balanceAfter: 100, createdAt: weeksAgo(30) },
      ],
    });
    expect(weighted.weightedAgeWeeks).toBe(5);
    expect(weighted.price).toBe(15);
    expect(capped.price).toBe(25);
  });

  test("applies the five-Buck floor and rounds up", () => {
    expect(
      calculatePeekPassPrice({
        balance: 5,
        now: NOW,
        ledger: [{ id: 1, delta: 5, balanceAfter: 5, createdAt: NOW }],
      }).price,
    ).toBe(5);
    expect(
      calculatePeekPassPrice({
        balance: 101,
        now: NOW,
        ledger: [{ id: 1, delta: 101, balanceAfter: 101, createdAt: NOW }],
      }).price,
    ).toBe(11);
  });

  test("fails loudly on per-entry or final ledger drift", () => {
    expect(() =>
      calculatePeekPassPrice({
        balance: 10,
        now: NOW,
        ledger: [{ id: 1, delta: 10, balanceAfter: 9, createdAt: NOW }],
      }),
    ).toThrow("ledger drift");
    expect(() =>
      calculatePeekPassPrice({
        balance: 9,
        now: NOW,
        ledger: [{ id: 1, delta: 10, balanceAfter: 10, createdAt: NOW }],
      }),
    ).toThrow("wallet drift");
  });
});
