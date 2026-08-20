import { describe, expect, test } from "bun:test";
import {
  DURATION_BUCKETS,
  HIT_RATES,
  MIN_PLAYER_CELL_GAMES,
  buildPlayerFrame,
  durationBucket,
} from "#src/betting/parlay-stats.ts";
import type { ParlayHistoryMatch } from "#src/betting/parlay-history.ts";

function match(input: {
  value: number;
  durationSeconds?: number;
  lane?: string;
  win?: boolean;
}): ParlayHistoryMatch {
  return {
    matchId: `NA1_${input.value.toString()}`,
    createdAtMs: 1_700_000_000_000 + input.value,
    durationSeconds: input.durationSeconds ?? 1800,
    win: input.win ?? true,
    lane: input.lane ?? "MIDDLE",
    values: new Map([["kills", input.value]]),
    teamValues: new Map([["dragon_kills", input.value]]),
    opponentValues: new Map([["enemy_missing_pings", 20]]),
  };
}

/** Fraction of games the threshold actually lands, by the leg's own operator. */
function realizedHitRate(
  values: readonly number[],
  threshold: number,
  operator: "gte" | "lte",
): number {
  const hits = values.filter((value) =>
    operator === "gte" ? value >= threshold : value <= threshold,
  ).length;
  return hits / values.length;
}

describe("duration buckets", () => {
  test("bucket labels are open at both ends", () => {
    expect(durationBucket(0)).toBe(10);
    expect(durationBucket(899)).toBe(10);
    expect(durationBucket(900)).toBe(20);
    expect(durationBucket(1499)).toBe(20);
    expect(durationBucket(1500)).toBe(30);
    expect(durationBucket(2099)).toBe(30);
    expect(durationBucket(2100)).toBe(40);
    expect(durationBucket(2699)).toBe(40);
    expect(durationBucket(2700)).toBe(50);
    expect(durationBucket(100_000)).toBe(50);
  });

  test("every bucket label is reachable", () => {
    const produced = new Set(
      [0, 1000, 1800, 2400, 3000].map((seconds) => durationBucket(seconds)),
    );
    expect([...produced].sort((a, b) => a - b)).toEqual([...DURATION_BUCKETS]);
  });
});

describe("hit-rate thresholds", () => {
  // The label is a promise about how often the leg lands. Inverting the
  // quantile would still produce plausible-looking numbers, and every parlay
  // would be mispriced in the same direction without anything failing.
  const values = Array.from({ length: 100 }, (_, index) => index + 1);

  test("gte thresholds land close to the rate they are named for", () => {
    const frame = buildPlayerFrame({
      matches: values.map((value) => match({ value })),
      column: "kills",
      operator: "gte",
      team: false,
    });
    for (const rate of HIT_RATES) {
      const realized = realizedHitRate(
        values,
        frame.overall.thresholds[rate],
        "gte",
      );
      expect(Math.abs(realized - rate / 100)).toBeLessThanOrEqual(0.03);
    }
  });

  test("lte thresholds invert the quantile rather than the rate", () => {
    const frame = buildPlayerFrame({
      matches: values.map((value) => match({ value })),
      column: "kills",
      operator: "lte",
      team: false,
    });
    for (const rate of HIT_RATES) {
      const realized = realizedHitRate(
        values,
        frame.overall.thresholds[rate],
        "lte",
      );
      expect(Math.abs(realized - rate / 100)).toBeLessThanOrEqual(0.03);
    }
  });

  test("a higher hit rate is never a harder threshold", () => {
    const frame = buildPlayerFrame({
      matches: values.map((value) => match({ value })),
      column: "kills",
      operator: "gte",
      team: false,
    });
    // For gte, landing more often means asking for less.
    expect(frame.overall.thresholds[90]).toBeLessThanOrEqual(
      frame.overall.thresholds[50],
    );
    expect(frame.overall.thresholds[50]).toBeLessThanOrEqual(
      frame.overall.thresholds[10],
    );
  });
});

describe("player frame slicing", () => {
  test("thin cells are omitted rather than reported as evidence", () => {
    const matches = [
      ...Array.from({ length: MIN_PLAYER_CELL_GAMES }, (_, index) =>
        match({ value: index, durationSeconds: 1800, lane: "MIDDLE" }),
      ),
      // One short game and one jungle game: real, but not a distribution.
      match({ value: 1, durationSeconds: 600, lane: "MIDDLE" }),
      match({ value: 2, durationSeconds: 1800, lane: "JUNGLE" }),
    ];
    const frame = buildPlayerFrame({
      matches,
      column: "kills",
      operator: "gte",
      team: false,
    });
    expect(frame.byBucket[30]).toBeDefined();
    expect(frame.byBucket[10]).toBeUndefined();
    expect(frame.byLane.MIDDLE).toBeDefined();
    expect(frame.byLane.JUNGLE).toBeUndefined();
    expect(frame.overall.n).toBe(matches.length);
  });

  test("duration and lane are separate marginals, never crossed", () => {
    // A flexer: 12 mid games and 12 jungle games, all the same duration. Both
    // lane cells and the single bucket cell must all carry the full count of
    // their own slice — a crossed frame would report 12 in a cell of 24.
    const matches = [
      ...Array.from({ length: 12 }, (_, index) =>
        match({ value: index, lane: "MIDDLE" }),
      ),
      ...Array.from({ length: 12 }, (_, index) =>
        match({ value: index + 100, lane: "JUNGLE" }),
      ),
    ];
    const frame = buildPlayerFrame({
      matches,
      column: "kills",
      operator: "gte",
      team: false,
    });
    expect(frame.byBucket[30]?.n).toBe(24);
    expect(frame.byLane.MIDDLE?.n).toBe(12);
    expect(frame.byLane.JUNGLE?.n).toBe(12);
  });

  test("team legs read the team column, not the subject's own", () => {
    const matches = Array.from({ length: 12 }, (_, index) =>
      match({ value: index }),
    );
    const frame = buildPlayerFrame({
      matches,
      column: "dragon_kills",
      operator: "gte",
      team: true,
    });
    expect(frame.overall.n).toBe(12);
    // values map has no dragon_kills; teamValues does. Reading the wrong one
    // would silently produce an all-zero distribution.
    expect(frame.overall.thresholds[10]).toBeGreaterThan(0);
  });
});
