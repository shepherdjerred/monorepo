import { RiotMatchIdSchema } from "@scout-for-lol/data";
import { describe, expect, test } from "vitest";
import {
  activeLane,
  championHeroLines,
  championScopeInput,
  championsIndexLines,
  compactPoints,
  formText,
  gamesText,
  matchupGroups,
  matchupLines,
  ordinal,
  popularChampions,
  recordText,
  yoursChampions,
  type ChampionHeroInput,
} from "#src/lib/champions/champion-pages.ts";
import {
  RIFT_STUDY_GROUP as GUILD,
  comparisonRow as row,
  indexChampion,
  matchupEntry as matchup,
  matchupTally as tally,
} from "#src/lib/champions/champion-fixtures.ts";

describe("championScopeInput", () => {
  test("sends the game window, queues and servers only when they are set", () => {
    expect(championScopeInput({ games: "all" }, undefined)).toEqual({
      games: "all",
    });
    expect(
      championScopeInput({ games: 20, queues: ["solo"] }, [GUILD]),
    ).toEqual({ games: 20, queues: ["solo"], guildIds: [GUILD] });
  });
});

describe("small formatters", () => {
  test("ordinals, games and records read as plain facts", () => {
    expect(
      [1, 2, 3, 4, 11, 12, 13, 21, 22].map((value) => ordinal(value)),
    ).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
    ]);
    expect(gamesText(1)).toBe("1 game");
    expect(gamesText(8)).toBe("8 games");
    expect(recordText(5, 2)).toBe("5 wins, 2 losses");
    expect(recordText(1, 0)).toBe("1 win, no losses");
    expect(recordText(0, 3)).toBe("no wins, 3 losses");
    expect(compactPoints(412_000)).toBe("412K");
  });

  test("form counts the wins among the games it has", () => {
    const results = [
      true,
      true,
      false,
      true,
      true,
      true,
      false,
      true,
      true,
      false,
    ];
    const last10 = results.map((win, index) => ({
      matchId: RiotMatchIdSchema.parse(
        `NA1_58000000${index.toString().padStart(2, "0")}`,
      ),
      win,
      playedAtMs: index,
    }));
    expect(formText(row({ last10 }))).toBe("Won 7 of the last 10");
    expect(formText(row({ last10: last10.slice(0, 4) }))).toBe(
      "Won 3 of the last 4",
    );
  });
});

describe("championsIndexLines", () => {
  test("names the favourite and the best friend on it", () => {
    const lines = championsIndexLines(
      indexChampion({
        bestFriend: {
          playerId: 2,
          alias: "RiverQuartz",
          guilds: [],
          games: 34,
          wins: 22,
          winRate: 22 / 34,
          qualified: true,
        },
      }),
    );
    expect(lines).toEqual({
      lead: "Ahri is the favourite in your servers.",
      sub: "6 friends play Ahri, and RiverQuartz is the best of them at 64.7%.",
    });
  });

  test("does not rank a friend who has too few games", () => {
    const lines = championsIndexLines(
      indexChampion({
        friendCount: 1,
        bestFriend: {
          playerId: 2,
          alias: "Quillon",
          guilds: [],
          games: 3,
          wins: 3,
          winRate: 1,
          qualified: false,
        },
      }),
    );
    expect(lines.sub).toBe("1 friend plays Ahri.");
  });

  test("falls back to the viewer when no friend plays it", () => {
    const lines = championsIndexLines(
      indexChampion({
        friendCount: 0,
        you: { games: 8, wins: 6, winRate: 0.75, lastPlayedMs: 0 },
      }),
    );
    expect(lines.sub).toBe("You have won 75.0% of 8 games.");
  });
});

describe("yours and popular", () => {
  const champions = [
    indexChampion({ championId: 1, name: "Ahri", friendCount: 6 }),
    indexChampion({
      championId: 2,
      name: "Syndra",
      friendCount: 0,
      you: { games: 4, wins: 2, winRate: 0.5, lastPlayedMs: 0 },
    }),
    indexChampion({
      championId: 3,
      name: "Yasuo",
      friendCount: 5,
      you: { games: 9, wins: 5, winRate: 5 / 9, lastPlayedMs: 0 },
    }),
  ];

  test("yours lists the viewer's champions, most played first", () => {
    expect(yoursChampions(champions).map((champion) => champion.name)).toEqual([
      "Yasuo",
      "Syndra",
    ]);
  });

  test("popular lists what friends play and a search looks through all of it", () => {
    expect(popularChampions(champions, "").map((c) => c.name)).toEqual([
      "Ahri",
      "Yasuo",
    ]);
    expect(popularChampions(champions, "  yas ").map((c) => c.name)).toEqual([
      "Yasuo",
    ]);
    expect(popularChampions(champions, "syn")).toEqual([]);
  });
});

describe("championHeroLines", () => {
  const base: Omit<ChampionHeroInput, "qualified" | "small"> = {
    name: "Ahri",
    qualifyingGames: 10,
    truncated: false,
  };

  test("ranks the viewer among everyone with enough games", () => {
    const lines = championHeroLines({
      ...base,
      qualified: [
        row({ alias: "RiverQuartz", games: 34, wins: 22, winRate: 22 / 34 }),
        row({
          alias: "Northstar",
          viewerLinked: true,
          games: 41,
          wins: 25,
          winRate: 25 / 41,
        }),
        row({ alias: "Halcyon", games: 18, wins: 10, winRate: 10 / 18 }),
      ],
      small: [],
    });
    expect(lines.lead).toBe(
      "You have the 2nd best win rate of 3 in your servers.",
    );
    expect(lines.sub).toBe(
      "61.0% against a group average of 61.3%, with the most games: 41.",
    );
  });

  test("leaves the count out when more rows exist than were read", () => {
    const lines = championHeroLines({
      ...base,
      truncated: true,
      qualified: [
        row({ viewerLinked: true, games: 12, wins: 9, winRate: 0.75 }),
        row({ alias: "Other", games: 30, wins: 15, winRate: 0.5 }),
      ],
      small: [],
    });
    expect(lines.lead).toBe("You have the best win rate in your servers.");
    expect(lines.sub).toContain("from 12 games");
  });

  test("speaks about the viewer's small sample, or the best friend, or the group", () => {
    expect(
      championHeroLines({
        ...base,
        qualified: [row({ alias: "RiverQuartz" })],
        small: [row({ viewerLinked: true, wins: 5, losses: 2, games: 7 })],
      }).lead,
    ).toBe("You have 5 wins, 2 losses on Ahri.");
    expect(
      championHeroLines({
        ...base,
        qualified: [row({ alias: "RiverQuartz" })],
        small: [],
      }).lead,
    ).toBe("RiverQuartz is best on Ahri, at 64.7%.");
    expect(
      championHeroLines({
        ...base,
        qualified: [],
        small: [row({ games: 3, wins: 1, losses: 2 }), row({ playerId: 2 })],
      }).lead,
    ).toBe("2 players have played Ahri.");
  });
});

describe("matchups", () => {
  test("labels the lane figure with its own game count", () => {
    expect(matchupLines(tally(5, 6, 5, 6))).toEqual({
      result: "Won 5 of 6 games",
      lane: "Ahead at 15 minutes in 5 of 6 lane games",
    });
    expect(matchupLines(tally(3, 4, 1, 1))).toEqual({
      result: "Won 3 of 4 games",
      lane: "Ahead at 15 minutes in 1 of 1 lane game",
    });
    expect(matchupLines(tally(1, 2, 0, 0)).lane).toBeUndefined();
  });

  test("splits the viewer's matchups by result and needs a few games", () => {
    const groups = matchupGroups([
      matchup(157, "Yasuo", tally(5, 6, 5, 6)),
      matchup(99, "Lux", tally(3, 4, 3, 4)),
      matchup(134, "Syndra", tally(1, 5, 1, 5)),
      matchup(84, "Akali", tally(1, 2, 1, 2)),
      matchup(1, "Annie", tally(2, 4, 2, 4)),
      matchup(2, "Zed", null),
    ]);
    expect(groups.good.map((entry) => entry.opponent.name)).toEqual([
      "Yasuo",
      "Lux",
    ]);
    expect(groups.hard.map((entry) => entry.opponent.name)).toEqual(["Syndra"]);
    expect(groups.lead).toBe("Good against Yasuo, rough against Syndra");
  });

  test("a single side still gets a plain headline", () => {
    expect(
      matchupGroups([matchup(134, "Syndra", tally(1, 5, 1, 5))]).lead,
    ).toBe("Rough against Syndra");
    expect(matchupGroups([]).lead).toBeUndefined();
  });

  test("the lane is the chosen one when the champion plays it, else the most played", () => {
    const lanes = [{ lane: "middle" as const }, { lane: "top" as const }];
    expect(activeLane(lanes, "top")).toBe("top");
    expect(activeLane(lanes, "support")).toBe("middle");
    expect(activeLane(lanes, undefined)).toBe("middle");
    expect(activeLane([], undefined)).toBeUndefined();
  });
});
