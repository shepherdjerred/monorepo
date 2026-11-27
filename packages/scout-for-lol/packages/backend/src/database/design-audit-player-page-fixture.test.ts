import {
  LeaguePuuidSchema,
  PlayerIdSchema,
  rankToLeaguePoints,
  leaguePointsDelta,
} from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { describe, expect, test } from "vitest";
import {
  CLIMB_END,
  climbSteps,
  lpChange,
  rankFromLeaguePoints,
  withNewestMultiKill,
} from "#src/database/design-audit-player-page-fixture.ts";
import type { TestLakeMatchFact } from "#src/testing/report-lake/rows.ts";

describe("rankFromLeaguePoints", () => {
  test("is the inverse of rankToLeaguePoints", () => {
    const record = { wins: 1, losses: 2 };
    for (const rank of [
      { tier: "silver", division: 2, lp: 67 },
      { tier: "gold", division: 4, lp: 0 },
      { tier: "emerald", division: 1, lp: 99 },
    ] as const) {
      expect(rankFromLeaguePoints(rankToLeaguePoints(rank), record)).toEqual({
        ...rank,
        ...record,
      });
    }
  });
});

describe("climbSteps", () => {
  const results = Array.from({ length: 60 }, (_, index) => index % 8 < 5);

  test("ends on the audit player's current rank", () => {
    const steps = climbSteps(results);
    expect(steps.at(-1)?.after).toEqual(CLIMB_END);
  });

  test("each game starts where the one before it ended, and moves LP by its result", () => {
    const steps = climbSteps(results);
    for (const [index, step] of steps.entries()) {
      const previous = steps[index - 1];
      if (previous !== undefined) {
        expect(step.before).toEqual(previous.after);
      }
      const win = results[index] ?? false;
      expect(leaguePointsDelta(step.before, step.after)).toBe(
        lpChange(win, index),
      );
    }
  });

  test("starts in a lower tier than it ends in, so the page has a climb to mark", () => {
    const first = climbSteps(results)[0];
    expect(rankToLeaguePoints(first?.before)).toBeLessThan(
      rankToLeaguePoints({ ...CLIMB_END, tier: "gold", division: 4, lp: 0 }),
    );
  });

  test("fails loudly when the games outnumber the record", () => {
    expect(() => climbSteps(Array.from({ length: 200 }, () => true))).toThrow(
      "more games than the record holds",
    );
  });
});

describe("withNewestMultiKill", () => {
  const puuid = LeaguePuuidSchema.parse("a".repeat(78));
  const other = LeaguePuuidSchema.parse("b".repeat(78));
  function fact(
    n: number,
    owner: typeof puuid,
    day: number,
  ): TestLakeMatchFact {
    return {
      playerId: PlayerIdSchema.parse(1),
      playerAlias: "Main",
      matchId: RiotMatchIdSchema.parse(`NA1_${(9_000_000_000 + n).toString()}`),
      puuid: owner,
      queue: "solo",
      win: true,
      surrendered: false,
      kills: 1,
      deaths: 1,
      assists: 1,
      gameCreationAt: new Date(Date.UTC(2026, 0, day)),
    };
  }

  test("gives only the audit player's newest game a quadra kill", () => {
    const facts = [fact(1, puuid, 1), fact(2, puuid, 3), fact(3, other, 9)];
    const marked = withNewestMultiKill(facts, puuid);
    expect(marked.map((entry) => entry.largestMultiKill)).toEqual([
      undefined,
      4,
      undefined,
    ]);
  });

  test("fails loudly when the player has no game", () => {
    expect(() => withNewestMultiKill([fact(3, other, 9)], puuid)).toThrow(
      "no game to give a multi-kill",
    );
  });
});
