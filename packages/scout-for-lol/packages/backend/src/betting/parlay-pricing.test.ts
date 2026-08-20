import { describe, expect, test } from "bun:test";
import { LeaguePuuidSchema } from "@scout-for-lol/data";
import type {
  ParlayCondition,
  ParlaySubject,
} from "#src/betting/parlay-criteria.ts";
import type {
  ParlayHistory,
  ParlayHistoryMatch,
} from "#src/betting/parlay-history.ts";
import {
  MIN_PRICING_GAMES,
  MAX_PRICE_BPS,
  MIN_PRICE_BPS,
  priceParlay,
} from "#src/betting/parlay-pricing.ts";

const PUUID_A = LeaguePuuidSchema.parse("a".repeat(78));
const PUUID_B = LeaguePuuidSchema.parse("b".repeat(78));

function subject(key: string, puuid: string): ParlaySubject {
  return { key, puuid: LeaguePuuidSchema.parse(puuid), alias: key };
}

function historyMatch(input: {
  index: number;
  kills: number;
  win?: boolean;
  durationSeconds?: number;
  dragons?: number;
}): ParlayHistoryMatch {
  return {
    matchId: `NA1_${input.index.toString()}`,
    createdAtMs: 1_700_000_000_000 + input.index,
    durationSeconds: input.durationSeconds ?? 1800,
    win: input.win ?? true,
    lane: "MIDDLE",
    values: new Map([["kills", input.kills]]),
    teamValues: new Map([["dragon_kills", input.dragons ?? 0]]),
  };
}

const killsAtLeast = (threshold: number): ParlayCondition => ({
  kind: "participant_numeric",
  subject: "P1",
  field: "kills",
  operator: "gte",
  threshold,
});

describe("joint replay pricing", () => {
  test("is the exact realised frequency over the subject's own games", () => {
    // 20 games, kills 1..20. "at least 16 kills" held in exactly 5 of them.
    const matches = Array.from({ length: 20 }, (_, index) =>
      historyMatch({ index, kills: index + 1 }),
    );
    const history: ParlayHistory = new Map([[PUUID_A, matches]]);
    const price = priceParlay({
      conditions: [killsAtLeast(16)],
      subjects: [subject("P1", PUUID_A)],
      history,
    });
    expect(price?.method).toBe("joint_replay");
    expect(price?.yesProbabilityBps).toBe(2500);
    expect(price?.samples).toBe(20);
    expect(price?.clamped).toBe(false);
  });

  test("carries correlation between legs rather than multiplying them", () => {
    // Kills and the win move together: the team won exactly the games where
    // kills were high. Independent multiplication would say 0.5 * 0.5 = 25%;
    // the truth is 50%, and replay gets it without modelling anything.
    const matches = Array.from({ length: 20 }, (_, index) =>
      historyMatch({ index, kills: index + 1, win: index >= 10 }),
    );
    const history: ParlayHistory = new Map([[PUUID_A, matches]]);
    const price = priceParlay({
      conditions: [
        killsAtLeast(11),
        {
          kind: "team_boolean",
          team: "selected",
          field: "win",
          expected: true,
        },
      ],
      subjects: [subject("P1", PUUID_A)],
      history,
    });
    expect(price?.yesProbabilityBps).toBe(5000);
  });

  test("team objective legs read the team column", () => {
    const matches = Array.from({ length: 20 }, (_, index) =>
      historyMatch({ index, kills: 10, dragons: index < 5 ? 3 : 0 }),
    );
    const history: ParlayHistory = new Map([[PUUID_A, matches]]);
    const price = priceParlay({
      conditions: [
        killsAtLeast(1),
        {
          kind: "team_objective_kills",
          team: "selected",
          objective: "dragon",
          operator: "gte",
          threshold: 2,
        },
      ],
      subjects: [subject("P1", PUUID_A)],
      history,
    });
    expect(price?.yesProbabilityBps).toBe(2500);
  });
});

describe("refusing to price", () => {
  test("a leg history cannot answer yields no price at all", () => {
    const matches = Array.from({ length: 20 }, (_, index) =>
      historyMatch({ index, kills: index + 1 }),
    );
    const history: ParlayHistory = new Map([[PUUID_A, matches]]);
    const price = priceParlay({
      // firstBloodKill is not reconstructable from lake columns.
      conditions: [
        killsAtLeast(5),
        {
          kind: "participant_boolean",
          subject: "P1",
          field: "firstBloodKill",
          expected: true,
        },
      ],
      subjects: [subject("P1", PUUID_A)],
      history,
    });
    // Crucially undefined, not a low number: an unpriceable leg must stop the
    // parlay rather than silently drag the price toward zero.
    expect(price).toBeUndefined();
  });

  test("too little history yields no price", () => {
    const matches = Array.from({ length: MIN_PRICING_GAMES - 1 }, (_, index) =>
      historyMatch({ index, kills: index + 1 }),
    );
    const history: ParlayHistory = new Map([[PUUID_A, matches]]);
    expect(
      priceParlay({
        conditions: [killsAtLeast(5)],
        subjects: [subject("P1", PUUID_A)],
        history,
      }),
    ).toBeUndefined();
  });

  test("a subject with no history at all yields no price", () => {
    expect(
      priceParlay({
        conditions: [killsAtLeast(5)],
        subjects: [subject("P1", PUUID_A)],
        history: new Map(),
      }),
    ).toBeUndefined();
  });
});

describe("price bounds", () => {
  test("a near-certain parlay is clamped and says so", () => {
    const matches = Array.from({ length: 20 }, (_, index) =>
      historyMatch({ index, kills: 50 }),
    );
    const history: ParlayHistory = new Map([[PUUID_A, matches]]);
    const price = priceParlay({
      conditions: [killsAtLeast(1)],
      subjects: [subject("P1", PUUID_A)],
      history,
    });
    expect(price?.yesProbabilityBps).toBe(MAX_PRICE_BPS);
    expect(price?.clamped).toBe(true);
  });

  test("an impossible parlay is clamped up to the floor", () => {
    const matches = Array.from({ length: 20 }, (_, index) =>
      historyMatch({ index, kills: 0 }),
    );
    const history: ParlayHistory = new Map([[PUUID_A, matches]]);
    const price = priceParlay({
      conditions: [killsAtLeast(40)],
      subjects: [subject("P1", PUUID_A)],
      history,
    });
    expect(price?.yesProbabilityBps).toBe(MIN_PRICE_BPS);
    expect(price?.clamped).toBe(true);
  });
});

describe("multi-subject combination", () => {
  test("prices subjects who have never shared a game", () => {
    // Deliberately disjoint histories, which is the real five-stack case.
    const a = Array.from({ length: 30 }, (_, index) =>
      historyMatch({ index, kills: index + 1, win: index % 2 === 0 }),
    );
    const b = Array.from({ length: 30 }, (_, index) =>
      historyMatch({
        index: index + 100,
        kills: index + 1,
        win: index % 2 === 0,
      }),
    );
    const history: ParlayHistory = new Map([
      [PUUID_A, a],
      [PUUID_B, b],
    ]);
    const price = priceParlay({
      conditions: [
        killsAtLeast(16),
        {
          kind: "participant_numeric",
          subject: "P2",
          field: "kills",
          operator: "gte",
          threshold: 16,
        },
      ],
      subjects: [subject("P1", PUUID_A), subject("P2", PUUID_B)],
      history,
    });
    expect(price?.method).toBe("conditional_combination");
    expect(price?.yesProbabilityBps).toBeGreaterThan(MIN_PRICE_BPS);
    expect(price?.yesProbabilityBps).toBeLessThan(MAX_PRICE_BPS);
  });

  test("refuses when any subject is short of history", () => {
    const a = Array.from({ length: 30 }, (_, index) =>
      historyMatch({ index, kills: index + 1 }),
    );
    const b = Array.from({ length: 5 }, (_, index) =>
      historyMatch({ index: index + 100, kills: index + 1 }),
    );
    const history: ParlayHistory = new Map([
      [PUUID_A, a],
      [PUUID_B, b],
    ]);
    expect(
      priceParlay({
        conditions: [
          killsAtLeast(16),
          {
            kind: "participant_numeric",
            subject: "P2",
            field: "kills",
            operator: "gte",
            threshold: 16,
          },
        ],
        subjects: [subject("P1", PUUID_A), subject("P2", PUUID_B)],
        history,
      }),
    ).toBeUndefined();
  });
});
