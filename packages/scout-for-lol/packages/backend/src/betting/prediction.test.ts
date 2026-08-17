import { describe, expect, test } from "bun:test";
import { RankSchema, type Rank } from "@scout-for-lol/data/index.ts";
import {
  predictWin,
  shouldDisplayPrediction,
  type PredictionParticipant,
} from "#src/betting/prediction.ts";

function rank(overrides: Partial<Rank> = {}): Rank {
  return RankSchema.parse({
    tier: "gold",
    division: 2,
    lp: 50,
    wins: 50,
    losses: 50,
    ...overrides,
  });
}

/** Five subject-side and five enemy-side participants, all identically ranked
 * unless overridden. */
function lobby(
  options: {
    own?: (Rank | undefined)[];
    enemy?: (Rank | undefined)[];
  } = {},
): PredictionParticipant[] {
  const own = options.own ?? Array.from({ length: 5 }, () => rank());
  const enemy = options.enemy ?? Array.from({ length: 5 }, () => rank());
  return [
    ...own.map((r) => ({ rank: r, isSubjectTeam: true })),
    ...enemy.map((r) => ({ rank: r, isSubjectTeam: false })),
  ];
}

/** A full team of one tier against a full team of another. */
function tierLobby(
  ownTier: Rank["tier"],
  enemyTier: Rank["tier"],
): PredictionParticipant[] {
  return lobby({
    own: Array.from({ length: 5 }, () => rank({ tier: ownTier })),
    enemy: Array.from({ length: 5 }, () => rank({ tier: enemyTier })),
  });
}

function diamond(): Rank {
  return rank({ tier: "diamond" });
}

describe("predictWin", () => {
  test("a symmetric lobby is exactly a coin flip", () => {
    // The whole formula has no intercept precisely so this holds. If it ever
    // drifts off 0.5, a bias has been introduced somewhere.
    const result = predictWin({
      subjectAlias: "Jerred",
      participants: lobby(),
    });

    expect(result.winProbability).toBe(0.5);
    expect(result.confidence).toBe("low");
    expect(result.sentence).toContain("coin flip");
  });

  test("only displays calls more than five points from even odds", () => {
    expect(shouldDisplayPrediction(0.45)).toBe(false);
    expect(shouldDisplayPrediction(0.49)).toBe(false);
    expect(shouldDisplayPrediction(0.55)).toBe(false);
    expect(shouldDisplayPrediction(0.6)).toBe(true);
  });

  test("a full tier of rank advantage moves the number meaningfully", () => {
    const result = predictWin({
      subjectAlias: "Jerred",
      participants: tierLobby("platinum", "gold"),
    });

    // Asserted as a range, so retuning the coefficient does not churn the test
    // while still pinning the direction and rough magnitude.
    expect(result.winProbability).toBeGreaterThan(0.55);
    expect(result.winProbability).toBeLessThan(0.75);
    expect(result.drivers.join(" ")).toContain("rank edge");
  });

  test("a rank deficit moves it the other way, symmetrically", () => {
    const ahead = predictWin({
      subjectAlias: "Jerred",
      participants: tierLobby("platinum", "gold"),
    });
    const behind = predictWin({
      subjectAlias: "Jerred",
      participants: tierLobby("gold", "platinum"),
    });

    expect(behind.winProbability).toBeCloseTo(1 - ahead.winProbability, 10);
  });

  test("win probability is monotonic in the subject team's rank", () => {
    const tiers = [
      "iron",
      "bronze",
      "silver",
      "gold",
      "platinum",
      "emerald",
      "diamond",
    ] as const;
    let previous = 0;
    for (const tier of tiers) {
      const result = predictWin({
        subjectAlias: "Jerred",
        participants: tierLobby(tier, "gold"),
      });
      expect(result.winProbability).toBeGreaterThanOrEqual(previous);
      previous = result.winProbability;
    }
  });

  test("drops the rank term when too few players are ranked", () => {
    const result = predictWin({
      subjectAlias: "Jerred",
      participants: lobby({
        own: [rank(), undefined, undefined, undefined, undefined],
        enemy: [rank(), undefined, undefined, undefined, undefined],
      }),
    });

    expect(result.confidence).toBe("low");
    expect(result.drivers.join(" ")).not.toContain("rank");
    expect(result.winProbability).toBeGreaterThanOrEqual(0.05);
    expect(result.winProbability).toBeLessThanOrEqual(0.95);
  });

  test("an unranked player is imputed the lobby mean, not Iron IV", () => {
    // Nine Diamond players and one unranked. Treating the unranked account as
    // Iron IV would drag its team down by hundreds of LP and swing the call;
    // imputing the lobby mean leaves the teams near even.
    const withUnranked = predictWin({
      subjectAlias: "Jerred",
      participants: lobby({
        own: [diamond(), diamond(), diamond(), diamond(), undefined],
        enemy: Array.from({ length: 5 }, diamond),
      }),
    });

    expect(withUnranked.winProbability).toBeCloseTo(0.5, 6);
  });

  test("recent form shifts the call and is named as a driver", () => {
    const hot = predictWin({
      subjectAlias: "Jerred",
      participants: lobby(),
      recentForm: { wins: 9, games: 10 },
    });
    const cold = predictWin({
      subjectAlias: "Jerred",
      participants: lobby(),
      recentForm: { wins: 1, games: 10 },
    });

    expect(hot.winProbability).toBeGreaterThan(0.5);
    expect(cold.winProbability).toBeLessThan(0.5);
    expect(hot.drivers.join(" ")).toContain("9-1 recent");
  });

  test("ignores form below the sample threshold", () => {
    const result = predictWin({
      subjectAlias: "Jerred",
      participants: lobby(),
      recentForm: { wins: 3, games: 3 },
      championForm: { wins: 2, games: 2 },
    });

    // Both samples are under their minimums, so nothing should move.
    expect(result.winProbability).toBe(0.5);
  });

  test("a missing form term degrades rather than throwing", () => {
    const result = predictWin({
      subjectAlias: "Jerred",
      participants: lobby(),
      recentForm: undefined,
      championForm: undefined,
    });
    expect(result.winProbability).toBe(0.5);
  });

  test("probability never reaches certainty, even on absurd input", () => {
    // Every term is individually clamped, so the logit is bounded by
    // 0.55*1.5 + 3*0.25 + 1.2*0.25 + 0.8*0.25 = 2.075, i.e. ~0.889. The model
    // structurally tops out below the 0.95 safety clamp rather than relying on
    // it — the clamp is a backstop, not the mechanism.
    const extreme = predictWin({
      subjectAlias: "Jerred",
      participants: lobby({
        own: Array.from({ length: 5 }, () =>
          rank({
            tier: "challenger",
            division: 1,
            lp: 2000,
            wins: 500,
            losses: 10,
          }),
        ),
        enemy: Array.from({ length: 5 }, () =>
          rank({ tier: "iron", division: 4, lp: 0, wins: 1, losses: 200 }),
        ),
      }),
      recentForm: { wins: 30, games: 30 },
      championForm: { wins: 20, games: 20 },
    });

    expect(extreme.winProbability).toBeLessThanOrEqual(0.95);
    expect(extreme.winProbability).toBeCloseTo(1 / (1 + Math.exp(-2.075)), 6);

    // And the mirror image is equally bounded away from zero.
    const inverted = predictWin({
      subjectAlias: "Jerred",
      participants: lobby({
        own: Array.from({ length: 5 }, () =>
          rank({ tier: "iron", division: 4, lp: 0, wins: 1, losses: 200 }),
        ),
        enemy: Array.from({ length: 5 }, () =>
          rank({
            tier: "challenger",
            division: 1,
            lp: 2000,
            wins: 500,
            losses: 10,
          }),
        ),
      }),
      recentForm: { wins: 0, games: 30 },
      championForm: { wins: 0, games: 20 },
    });

    expect(inverted.winProbability).toBeGreaterThanOrEqual(0.05);
    expect(inverted.winProbability).toBeCloseTo(1 - extreme.winProbability, 6);
  });

  test("the sentence stays within the Discord line budget", () => {
    const result = predictWin({
      subjectAlias: "A".repeat(40),
      participants: tierLobby("platinum", "gold"),
      recentForm: { wins: 9, games: 10 },
      championForm: { wins: 8, games: 10 },
    });

    expect(result.sentence.length).toBeLessThanOrEqual(120);
    expect(result.sentence).toContain("%");
  });

  test("is deterministic for identical input", () => {
    const input = {
      subjectAlias: "Jerred",
      participants: tierLobby("platinum", "gold"),
      recentForm: { wins: 7, games: 10 },
    };
    expect(predictWin(input)).toEqual(predictWin(input));
  });

  test("reports high confidence only on a fully ranked, decisive lobby", () => {
    const decisive = predictWin({
      subjectAlias: "Jerred",
      participants: tierLobby("diamond", "silver"),
    });
    expect(decisive.confidence).toBe("high");

    const marginal = predictWin({
      subjectAlias: "Jerred",
      participants: lobby({
        own: Array.from({ length: 5 }, () => rank({ lp: 60 })),
        enemy: Array.from({ length: 5 }, () => rank({ lp: 50 })),
      }),
    });
    expect(marginal.confidence).not.toBe("high");
  });
});
