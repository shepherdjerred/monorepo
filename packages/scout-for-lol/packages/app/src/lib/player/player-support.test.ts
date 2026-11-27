import { PLAYER_PROFILE_QUEUE_PRESETS, type Rank } from "@scout-for-lol/data";
import { describe, expect, test } from "vitest";
import {
  allGamesFilters,
  includedQueues,
  isAllGames,
  isRankedGames,
  rankedFilters,
  toggleQueue,
} from "#src/lib/player/feed-filters.ts";
import { streakPhrase, wonOfLast } from "#src/lib/player/form-text.ts";
import {
  accountsSentence,
  joinWithAnd,
  masterySentence,
  playTimesSentence,
} from "#src/lib/player/player-about.ts";
import { playerSummary } from "#src/lib/player/player-fixtures.ts";
import { rankName, rankParts, rankText } from "#src/lib/player/rank-parts.ts";

describe("form text", () => {
  test("a streak needs two games and says which way it runs", () => {
    expect(streakPhrase(null)).toBeUndefined();
    expect(
      streakPhrase({ result: "win", games: 1, atLeast: false }),
    ).toBeUndefined();
    expect(streakPhrase({ result: "win", games: 3, atLeast: false })).toBe(
      "a 3-game win streak",
    );
    expect(streakPhrase({ result: "loss", games: 5, atLeast: false })).toBe(
      "a 5-game losing streak",
    );
    expect(streakPhrase({ result: "win", games: 1000, atLeast: true })).toBe(
      "a win streak of 1,000 games or more",
    );
  });

  test("the record reads as the last games", () => {
    expect(wonOfLast(12, 20)).toBe("Won 12 of the last 20");
    expect(wonOfLast(1, 1)).toBe("Won the last game");
    expect(wonOfLast(0, 1)).toBe("Lost the last game");
  });
});

describe("rank parts", () => {
  test("a rank is a crest, a division and LP", () => {
    const rank: Rank = {
      tier: "emerald",
      division: 2,
      lp: 64,
      wins: 1,
      losses: 1,
    };
    expect(rankParts(rank)).toEqual({
      rank: "Emerald",
      division: "II",
      leaguePoints: 64,
    });
    expect(rankName(rank)).toBe("Emerald II");
    expect(rankText(rank)).toBe("Emerald II, 64 LP");
  });

  test("Master and above have no division", () => {
    const rank: Rank = {
      tier: "grandmaster",
      division: 1,
      lp: 400,
      wins: 1,
      losses: 1,
    };
    expect(rankName(rank)).toBe("Grandmaster");
    expect(rankText(rank)).toBe("Grandmaster, 400 LP");
  });
});

describe("feed filters", () => {
  test("All and Ranked are two states of the queue filter", () => {
    expect(isAllGames({ games: "all" })).toBe(true);
    expect(isRankedGames({ games: "all" })).toBe(false);
    const ranked = rankedFilters({ games: 50 });
    expect(ranked).toEqual({
      games: 50,
      queues: [...PLAYER_PROFILE_QUEUE_PRESETS.competitive],
    });
    expect(isRankedGames(ranked)).toBe(true);
    expect(isAllGames(ranked)).toBe(false);
    expect(allGamesFilters(ranked)).toEqual({ games: 50 });
  });

  test("a custom set of queues is neither", () => {
    const custom = { games: 20 as const, queues: ["solo" as const] };
    expect(isAllGames(custom)).toBe(false);
    expect(isRankedGames(custom)).toBe(false);
    expect(includedQueues(custom)).toEqual(["solo"]);
  });

  test("toggling a queue off from All leaves every other queue on", () => {
    const next = toggleQueue(undefined, "solo");
    expect(next).toBeDefined();
    expect(next).not.toContain("solo");
    expect(next).toContain("flex");
  });

  test("the last queue cannot be turned off, and turning every queue on is All", () => {
    expect(toggleQueue(["solo"], "solo")).toEqual(["solo"]);
    const all = includedQueues({ games: "all" });
    const withoutSolo = all.filter((queue) => queue !== "solo");
    expect(toggleQueue(withoutSolo, "solo")).toBeUndefined();
    expect(toggleQueue(["solo"], "flex")).toEqual(["solo", "flex"]);
  });
});

const mastery = (points: number, name: string) => ({
  fetchedAt: "2026-11-01T00:00:00.000Z",
  freshness: "fresh" as const,
  champions: [
    {
      championId: 103,
      championName: name,
      level: 12,
      points,
      lastPlayedAt: "2026-11-01T00:00:00.000Z",
    },
  ],
});

describe("about sentences", () => {
  test("lists are joined with commas and a final and", () => {
    expect(joinWithAnd([])).toBe("");
    expect(joinWithAnd(["A"])).toBe("A");
    expect(joinWithAnd(["A", "B"])).toBe("A and B");
    expect(joinWithAnd(["A", "B", "C"])).toBe("A, B and C");
  });

  const accounts = playerSummary().accounts;
  const first = accounts[0];
  if (first === undefined) throw new Error("The fixture has no account");

  test("accounts share a region in one clause, or name each region", () => {
    expect(accountsSentence(accounts)).toBe("Northstar#NA1, in North America.");
    const second = { ...first, gameName: "MapleCarry", tagLine: "NOVA" };
    expect(accountsSentence([first, second])).toBe(
      "Northstar#NA1 and MapleCarry#NOVA, both in North America.",
    );
    expect(accountsSentence([first, { ...second, region: "EU_WEST" }])).toBe(
      "Northstar#NA1 in North America and MapleCarry#NOVA in Europe West.",
    );
  });

  test("mastery names the highest champion across accounts", () => {
    expect(masterySentence(accounts)).toBeUndefined();
    expect(
      masterySentence([
        { ...first, mastery: mastery(120_000, "Syndra") },
        { ...first, mastery: mastery(412_000, "Ahri") },
      ]),
    ).toBe("Ahri is the highest, level 12 with 412K points.");
  });
});

describe("playTimesSentence", () => {
  // 2026-11-21 is a Saturday.
  const saturdayEvening = Date.UTC(2026, 10, 21, 19, 0, 0);
  const tuesdayMorning = Date.UTC(2026, 10, 24, 8, 0, 0);

  test("names the part of the day and the day most games fall in", () => {
    const times = [
      ...Array.from({ length: 6 }, () => saturdayEvening),
      ...Array.from({ length: 4 }, () => tuesdayMorning),
    ];
    expect(playTimesSentence(times, "UTC")).toBe(
      "Mostly evenings, and most of all on Saturdays.",
    );
  });

  test("says nothing about too few games", () => {
    expect(playTimesSentence([saturdayEvening], "UTC")).toBeUndefined();
  });

  test("leaves out a pattern too even to name", () => {
    const day = 86_400_000;
    // One game a day at the same hour: the days are even, the hour is not.
    const evenDays = Array.from(
      { length: 14 },
      (_, index) => saturdayEvening + index * day,
    );
    expect(playTimesSentence(evenDays, "UTC")).toBe("Mostly evenings.");
  });
});
