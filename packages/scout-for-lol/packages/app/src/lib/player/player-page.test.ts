import { describe, expect, test } from "vitest";
import {
  bestChampions,
  heroAbout,
  heroArtChampion,
  heroRank,
  latelyLines,
  multiKillLabel,
  playerSummaryInput,
  playsWith,
  stickers,
} from "#src/lib/player/player-page.ts";
import {
  matchId,
  NOW_MS,
  PLAYER_ID,
  playerSummary,
  poolEntry,
} from "#src/lib/player/player-fixtures.ts";

describe("playerSummaryInput", () => {
  test("sends the games window and queues only when they are set", () => {
    expect(playerSummaryInput(PLAYER_ID, { games: "all" })).toEqual({
      playerId: PLAYER_ID,
      games: "all",
    });
    expect(
      playerSummaryInput(PLAYER_ID, { games: 20, queues: ["solo"] }),
    ).toEqual({ playerId: PLAYER_ID, games: 20, queues: ["solo"] });
  });
});

describe("latelyLines", () => {
  test("states the record, the streak, the win rate and the KDA", () => {
    const lines = latelyLines(playerSummary());
    expect(lines?.lead).toBe("Won 12 of the last 20");
    expect(lines?.sub).toBe(
      "On a 3-game win streak, with a 60.0% win rate and a 3.42 KDA.",
    );
  });

  test("draws the results oldest first, so the newest game ends the strip", () => {
    const lines = latelyLines(playerSummary());
    expect(lines?.results).toHaveLength(20);
    // The fixture's three newest games are wins.
    expect(lines?.results.slice(-3)).toEqual(["win", "win", "win"]);
    expect(lines?.results[0]).toBe("loss");
  });

  test("drops the streak clause when there is no run, and the KDA without one", () => {
    const summary = playerSummary();
    const lines = latelyLines({
      ...summary,
      highlights: { ...summary.highlights, streak: null },
      behavior: { ...summary.behavior, recent20: null },
    });
    expect(lines?.sub).toBe("With a 60.0% win rate.");
  });

  test("calls a loss run a losing streak and one game just that game", () => {
    const summary = playerSummary();
    const losing = latelyLines({
      ...summary,
      highlights: {
        ...summary.highlights,
        streak: { result: "loss", games: 4, atLeast: false },
      },
    });
    expect(losing?.sub).toContain("On a 4-game losing streak");
    const one = latelyLines({
      ...summary,
      highlights: {
        ...summary.highlights,
        lately: {
          games: 1,
          wins: 0,
          results: [{ matchId: matchId(1), win: false }],
        },
      },
    });
    expect(one?.lead).toBe("Lost the last game");
    expect(one?.sub).toBeUndefined();
  });

  test("is absent for a player with no games", () => {
    const summary = playerSummary();
    expect(
      latelyLines({
        ...summary,
        highlights: { ...summary.highlights, lately: null },
      }),
    ).toBeNull();
  });
});

describe("heroRank", () => {
  test("leads with Solo/Duo and follows with Flex", () => {
    const rank = heroRank(playerSummary().ranks);
    expect(rank?.parts).toEqual({
      rank: "Emerald",
      division: "II",
      leaguePoints: 64,
    });
    expect(rank?.secondary).toBe("Platinum I, 12 LP in Flex");
  });

  test("leads with Flex, and says so, when there is no Solo/Duo rank", () => {
    const rank = heroRank({
      flex: { tier: "gold", division: 3, lp: 5, wins: 1, losses: 1 },
    });
    expect(rank?.parts.rank).toBe("Gold");
    expect(rank?.secondary).toBe("Flex");
  });

  test("has nothing for an unranked player or one with no accounts", () => {
    expect(heroRank({})).toBeUndefined();
    expect(heroRank({ solo: undefined, flex: undefined })).toBeUndefined();
  });

  test("leaves the division off Master and above", () => {
    const rank = heroRank({
      solo: { tier: "master", division: 1, lp: 212, wins: 1, losses: 1 },
    });
    expect(rank?.parts.division).toBeUndefined();
  });
});

describe("heroAbout", () => {
  test("names the main position, the server and the three most played champions", () => {
    expect(heroAbout(playerSummary())).toEqual({
      main: "Mid main",
      guild: "Rift Study Group",
      champions: [
        { championId: 103, name: "Ahri" },
        { championId: 134, name: "Syndra" },
        { championId: 61, name: "Orianna" },
      ],
    });
  });

  test("names no main when no position reaches half the games", () => {
    const summary = playerSummary();
    const about = heroAbout({
      ...summary,
      recentForm: summary.recentForm && {
        ...summary.recentForm,
        preferredPositions: [{ position: "TOP", games: 6, percentage: 30 }],
      },
    });
    expect(about.main).toBeUndefined();
  });

  test("names no champions for an empty pool", () => {
    expect(heroAbout(playerSummary({ championPool: [] })).champions).toEqual(
      [],
    );
  });
});

describe("heroArtChampion", () => {
  test("is the best champion, else the most played", () => {
    expect(heroArtChampion(playerSummary())).toBe(103);
    const summary = playerSummary();
    expect(
      heroArtChampion({
        ...summary,
        highlights: { ...summary.highlights, bestChampion: null },
        championPool: [
          poolEntry({ championId: 1, games: 2 }),
          poolEntry({ championId: 2, games: 9 }),
        ],
      }),
    ).toBe(2);
    expect(
      heroArtChampion({
        ...summary,
        highlights: { ...summary.highlights, bestChampion: null },
        championPool: [],
      }),
    ).toBeUndefined();
  });
});

describe("bestChampions", () => {
  test("lists the pool most games first, as percents, with the small samples flagged", () => {
    const champions = bestChampions(playerSummary());
    expect(champions.map((champion) => champion.name)).toEqual([
      "Ahri",
      "Syndra",
      "Orianna",
    ]);
    expect(champions[0]?.winRate).toBe(75);
    expect(champions[2]?.lowSample).toBe(true);
  });
});

describe("playsWith", () => {
  const friends = [
    { playerId: 2, alias: "RiverQuartz", games: 9, wins: 6, lastGameMs: 1 },
    { playerId: 3, alias: "TidalWren", games: 3, wins: 1, lastGameMs: 1 },
  ];

  test("leads with the friend with the most games and tallies wins then losses", () => {
    const summary = playerSummary();
    const result = playsWith({
      ...summary,
      playsWith: { windowDays: 90, friends },
    });
    expect(result?.lead).toBe("Mostly with RiverQuartz");
    expect(result?.friends[0]?.text).toBe("9 games together, won 6");
    expect(result?.friends[1]?.tally).toEqual(["win", "loss", "loss"]);
  });

  test("is absent without friends", () => {
    expect(playsWith(playerSummary())).toBeNull();
  });
});

describe("stickers", () => {
  const latest = {
    matchId: matchId(1),
    win: true,
    championId: 222,
    championName: "Jinx",
    teamPosition: "BOTTOM",
    kills: 12,
    deaths: 3,
    assists: 8,
    largestMultiKill: 4,
    queue: "solo",
    queueId: 420,
    gameCreationMs: NOW_MS,
    gameDurationSeconds: 1800,
    placement: null,
    leaguePointsDelta: 19,
  };

  test("a multi-kill in the newest game earns a sticker", () => {
    const summary = playerSummary();
    const earned = stickers({
      ...summary,
      highlights: { ...summary.highlights, latestGame: latest },
    });
    expect(earned).toEqual([
      {
        title: "Quadra kill as Jinx",
        championId: 222,
        matchId: matchId(1),
        atMs: NOW_MS,
      },
    ]);
  });

  test("an ordinary game earns nothing", () => {
    const summary = playerSummary();
    expect(
      stickers({
        ...summary,
        highlights: {
          ...summary.highlights,
          latestGame: { ...latest, largestMultiKill: 2 },
        },
      }),
    ).toEqual([]);
    expect(stickers(summary)).toEqual([]);
  });

  test("names triple and penta kills", () => {
    expect(multiKillLabel(3)).toBe("Triple kill");
    expect(multiKillLabel(5)).toBe("Penta kill");
    expect(multiKillLabel(2)).toBeUndefined();
  });
});
