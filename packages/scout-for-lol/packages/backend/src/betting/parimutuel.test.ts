import { describe, expect, test } from "bun:test";
import { BUCKS_INT32_MAX } from "@scout-for-lol/data";
import {
  computeParimutuelPayouts,
  type ParimutuelBet,
} from "#src/betting/parimutuel.ts";

const BLUE = 100;
const RED = 200;

function bet(betId: number, predictedTeamId: number, stake: number) {
  return { betId, predictedTeamId, stake };
}

/**
 * Conservation is the invariant the whole economy rests on: a pool must pay
 * out exactly what was staked into it, no more and no less. Every case below
 * asserts it, because a rounding bug here mints or destroys currency silently.
 */
function expectConserved(
  bets: readonly ParimutuelBet[],
  winningTeamId: number,
) {
  const result = computeParimutuelPayouts(bets, winningTeamId);
  const staked = bets.reduce((total, b) => total + b.stake, 0);
  if (result.kind === "refund_all") {
    expect(result.totalStake).toBe(staked);
    return result;
  }
  if (result.kind === "storage_overflow") {
    throw new Error("fixture unexpectedly overflowed Int32 storage");
  }
  const paid = result.allocations.reduce((total, a) => total + a.payout, 0);
  expect(paid).toBe(staked);
  return result;
}

describe("computeParimutuelPayouts", () => {
  test("splits the losing pool in proportion to stake", () => {
    const bets = [
      bet(1, BLUE, 10),
      bet(2, BLUE, 20),
      bet(3, BLUE, 30),
      bet(4, RED, 60),
    ];
    const result = expectConserved(bets, BLUE);
    if (result.kind !== "paid") {
      throw new Error("expected a paid result");
    }

    expect(result.winnersPool).toBe(60);
    expect(result.losersPool).toBe(60);

    // Winners staked 60 against a losing pool of 60, so each doubles up.
    const byId = new Map(result.allocations.map((a) => [a.betId, a]));
    expect(byId.get(1)?.payout).toBe(20);
    expect(byId.get(2)?.payout).toBe(40);
    expect(byId.get(3)?.payout).toBe(60);
    expect(byId.get(4)).toBeUndefined();
  });

  test("hands the indivisible remainder to the largest stake", () => {
    // Winning stakes 5/3/2 against a losing pool of 7. The exact shares are
    // 3.5/2.1/1.4, so the floors are 3/2/1 and one Buck of dust is left over.
    // It goes to the largest stake.
    const bets = [
      bet(1, BLUE, 5),
      bet(2, BLUE, 3),
      bet(3, BLUE, 2),
      bet(4, RED, 7),
    ];
    const result = expectConserved(bets, BLUE);
    if (result.kind !== "paid") {
      throw new Error("expected a paid result");
    }

    const byId = new Map(result.allocations.map((a) => [a.betId, a]));
    expect(byId.get(1)?.winnings).toBe(4);
    expect(byId.get(2)?.winnings).toBe(2);
    expect(byId.get(3)?.winnings).toBe(1);
  });

  test("conserves when the division genuinely rounds", () => {
    // Winning stakes 1/1/1 against a losing pool of 10: floors give 3/3/3 = 9,
    // leaving 1 Buck of dust that must still be paid.
    const bets = [
      bet(1, BLUE, 1),
      bet(2, BLUE, 1),
      bet(3, BLUE, 1),
      bet(4, RED, 10),
    ];
    const result = expectConserved(bets, BLUE);
    if (result.kind !== "paid") {
      throw new Error("expected a paid result");
    }

    const winnings = result.allocations
      .map((a) => a.winnings)
      .sort((a, b) => a - b);
    expect(winnings).toEqual([3, 3, 4]);
  });

  test("dust allocation is deterministic regardless of input order", () => {
    const bets = [
      bet(1, BLUE, 1),
      bet(2, BLUE, 1),
      bet(3, BLUE, 1),
      bet(9, RED, 10),
    ];
    const forward = computeParimutuelPayouts(bets, BLUE);
    const reversed = computeParimutuelPayouts([...bets].reverse(), BLUE);

    if (forward.kind !== "paid" || reversed.kind !== "paid") {
      throw new Error("expected paid results");
    }

    const normalize = (result: typeof forward) =>
      [...result.allocations].sort((a, b) => a.betId - b.betId);
    expect(normalize(forward)).toEqual(normalize(reversed));

    // Equal stakes tie, so the extra Buck goes to the lowest betId.
    const byId = new Map(forward.allocations.map((a) => [a.betId, a]));
    expect(byId.get(1)?.winnings).toBe(4);
  });

  test("refunds everyone when nobody took the other side", () => {
    const bets = [bet(1, BLUE, 5), bet(2, BLUE, 7)];
    const result = expectConserved(bets, BLUE);
    expect(result.kind).toBe("refund_all");
  });

  test("refunds everyone when every bet lost", () => {
    // Same shape from the other direction: an empty winners pool has nobody to
    // distribute to, so the losers get their stakes back rather than the pool
    // vanishing.
    const bets = [bet(1, RED, 5), bet(2, RED, 7)];
    const result = expectConserved(bets, BLUE);
    expect(result.kind).toBe("refund_all");
  });

  test("an empty pool is a refund of nothing", () => {
    const result = computeParimutuelPayouts([], BLUE);
    expect(result).toEqual({ kind: "refund_all", totalStake: 0 });
  });

  test("reports overflow instead of converting aggregate bigint math", () => {
    expect(
      computeParimutuelPayouts(
        [bet(1, BLUE, BUCKS_INT32_MAX), bet(2, RED, BUCKS_INT32_MAX)],
        BLUE,
      ),
    ).toEqual({ kind: "storage_overflow" });
    expect(
      computeParimutuelPayouts(
        [bet(1, BLUE, BUCKS_INT32_MAX), bet(2, BLUE, BUCKS_INT32_MAX)],
        BLUE,
      ),
    ).toEqual({ kind: "storage_overflow" });
  });

  test("conserves across a table of lopsided pools", () => {
    const cases: { bets: ParimutuelBet[]; winner: number }[] = [
      { bets: [bet(1, BLUE, 1), bet(2, RED, 999)], winner: BLUE },
      { bets: [bet(1, BLUE, 999), bet(2, RED, 1)], winner: BLUE },
      {
        bets: [
          bet(1, BLUE, 7),
          bet(2, BLUE, 11),
          bet(3, BLUE, 13),
          bet(4, RED, 17),
          bet(5, RED, 19),
        ],
        winner: BLUE,
      },
      {
        bets: [
          bet(1, BLUE, 1000),
          bet(2, RED, 1000),
          bet(3, RED, 1000),
          bet(4, RED, 1000),
        ],
        winner: RED,
      },
    ];

    for (const { bets, winner } of cases) {
      expectConserved(bets, winner);
    }
  });

  test("winnings never exceed the losing pool", () => {
    const bets = [bet(1, BLUE, 5), bet(2, BLUE, 5), bet(3, RED, 3)];
    const result = expectConserved(bets, BLUE);
    if (result.kind !== "paid") {
      throw new Error("expected a paid result");
    }
    const totalWinnings = result.allocations.reduce(
      (total, a) => total + a.winnings,
      0,
    );
    expect(totalWinnings).toBe(result.losersPool);
  });
});
