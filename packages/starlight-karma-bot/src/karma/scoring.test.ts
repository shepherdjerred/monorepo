import { describe, expect, test } from "bun:test";
import {
  ALLOWED_KARMA_AMOUNTS,
  formatLeaderboardLine,
  InvalidKarmaAmountError,
  karmaAmountFor,
  KARMA_GIVE_AMOUNT,
  paginate,
  parseKarmaAmount,
  periodStart,
  rankLeaderboard,
  type KarmaCount,
} from "./scoring.ts";

describe("periodStart", () => {
  const now = new Date("2026-08-08T12:34:56.000Z");

  test("all-time has no lower bound", () => {
    expect(periodStart("all", now)).toBeUndefined();
  });

  test("year starts at January 1 UTC", () => {
    expect(periodStart("year", now)?.toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  test("month starts at the 1st UTC", () => {
    expect(periodStart("month", now)?.toISOString()).toBe(
      "2026-08-01T00:00:00.000Z",
    );
  });
});

describe("paginate", () => {
  const items = Array.from({ length: 45 }, (_, index) => index);

  test("slices the requested page", () => {
    expect(paginate(items, 0, 15).items).toEqual(items.slice(0, 15));
    expect(paginate(items, 2, 15).items).toEqual(items.slice(30, 45));
  });

  test("reports the total page count", () => {
    expect(paginate(items, 0, 15).totalPages).toBe(3);
    expect(paginate(items, 0, 20).totalPages).toBe(3);
  });

  test("clamps an out-of-range page instead of erroring", () => {
    // A stale pagination button must stay harmless after entries are removed.
    expect(paginate(items, 99, 15).page).toBe(2);
    expect(paginate(items, -5, 15).page).toBe(0);
  });

  test("an empty list still has one page", () => {
    expect(paginate([], 0, 15)).toEqual({ items: [], page: 0, totalPages: 1 });
  });
});

describe("karmaAmountFor", () => {
  test("awards a point when giving to someone else", () => {
    expect(karmaAmountFor("giver", "receiver")).toBe(KARMA_GIVE_AMOUNT);
    expect(karmaAmountFor("giver", "receiver")).toBe(1);
  });

  test("awards the requested amount", () => {
    expect(karmaAmountFor("giver", "receiver", 2)).toBe(2);
    expect(karmaAmountFor("giver", "receiver", 3)).toBe(3);
  });

  test("penalizes giving karma to yourself by the amount requested", () => {
    // Asking for 3 is a bigger stunt than asking for 1, so it stings more.
    expect(karmaAmountFor("same", "same")).toBe(-1);
    expect(karmaAmountFor("same", "same", 3)).toBe(-3);
  });

  test("rejects an out-of-range amount rather than clamping it", () => {
    expect(() => karmaAmountFor("giver", "receiver", 42)).toThrow(
      InvalidKarmaAmountError,
    );
  });
});

describe("parseKarmaAmount", () => {
  test.each([...ALLOWED_KARMA_AMOUNTS])("accepts %i", (amount) => {
    expect(parseKarmaAmount(amount)).toBe(amount);
  });

  test("accepts the string form a modal text input produces", () => {
    expect(parseKarmaAmount("2")).toBe(2);
    expect(parseKarmaAmount("  3  ")).toBe(3);
  });

  test.each([
    [0, "zero"],
    [4, "above the ceiling"],
    [-1, "negative"],
    [1.5, "fractional"],
    ["", "empty string"],
    ["two", "spelled out"],
    [null, "null"],
    [undefined, "undefined"],
    [Number.NaN, "NaN"],
  ])("rejects %p (%s)", (value) => {
    expect(() => parseKarmaAmount(value)).toThrow(InvalidKarmaAmountError);
  });
});

describe("rankLeaderboard", () => {
  test("assigns sequential ranks to strictly descending scores", () => {
    const counts: KarmaCount[] = [
      { id: "a", karmaReceived: 10 },
      { id: "b", karmaReceived: 7 },
      { id: "c", karmaReceived: 3 },
    ];

    expect(rankLeaderboard(counts).map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  test("gives tied scores the same rank (dense ranking)", () => {
    const counts: KarmaCount[] = [
      { id: "a", karmaReceived: 10 },
      { id: "b", karmaReceived: 10 },
      { id: "c", karmaReceived: 5 },
      { id: "d", karmaReceived: 5 },
      { id: "e", karmaReceived: 1 },
    ];

    expect(rankLeaderboard(counts).map((e) => e.rank)).toEqual([1, 1, 2, 2, 3]);
  });

  test("preserves the input order and ids without re-sorting", () => {
    const counts: KarmaCount[] = [
      { id: "a", karmaReceived: 5 },
      { id: "b", karmaReceived: 5 },
      { id: "c", karmaReceived: 9 },
    ];

    // The function ranks in the given order; it does not sort. The third row
    // (9) is a new distinct value after the tie, so it becomes rank 2.
    expect(rankLeaderboard(counts)).toEqual([
      { id: "a", karmaReceived: 5, rank: 1 },
      { id: "b", karmaReceived: 5, rank: 1 },
      { id: "c", karmaReceived: 9, rank: 2 },
    ]);
  });

  test("handles an empty leaderboard", () => {
    expect(rankLeaderboard([])).toEqual([]);
  });

  test("ranks negative and zero scores without special-casing", () => {
    const counts: KarmaCount[] = [
      { id: "a", karmaReceived: 0 },
      { id: "b", karmaReceived: 0 },
      { id: "c", karmaReceived: -3 },
    ];

    expect(rankLeaderboard(counts).map((e) => e.rank)).toEqual([1, 1, 2]);
  });
});

describe("formatLeaderboardLine", () => {
  test("bolds ranks in the top three", () => {
    const line = formatLeaderboardLine(
      { id: "a", karmaReceived: 12, rank: 1 },
      "Alice",
    );
    expect(line).toBe("**#1**: Alice (12 karma)");
  });

  test("bolds rank three but not rank four", () => {
    const third = formatLeaderboardLine(
      { id: "c", karmaReceived: 4, rank: 3 },
      "Carol",
    );
    const fourth = formatLeaderboardLine(
      { id: "d", karmaReceived: 2, rank: 4 },
      "Dave",
    );

    expect(third).toBe("**#3**: Carol (4 karma)");
    expect(fourth).toBe("#4: Dave (2 karma)");
  });

  test("uses the provided display name verbatim (e.g. a mention)", () => {
    const line = formatLeaderboardLine(
      { id: "123", karmaReceived: 8, rank: 2 },
      "<@123>",
    );
    expect(line).toBe("**#2**: <@123> (8 karma)");
  });
});
