import { describe, expect, test } from "vitest";
import {
  matchId,
  NOW_MS,
  RIFT_STUDY_GROUP,
} from "#src/lib/player/player-fixtures.ts";
import {
  GUILDS,
  LIVE_GAME,
  MIDNIGHT_SCRIMS,
  rosterPlayer,
} from "#src/lib/players/roster-fixtures.ts";
import {
  isSearchReady,
  latestLine,
  playersIn,
  playersMatching,
  rosterHero,
  rowRank,
  youIn,
  youLine,
  type Roster,
} from "#src/lib/players/roster-page.ts";

function roster(players: Roster["players"]): Roster {
  return { guilds: GUILDS, players };
}

describe("search readiness", () => {
  test("starts after two trimmed characters", () => {
    expect(isSearchReady("")).toBe(false);
    expect(isSearchReady(" n ")).toBe(false);
    expect(isSearchReady(" no ")).toBe(true);
  });
});

describe("playersIn", () => {
  const both = rosterPlayer(1, "Both", {
    memberships: [
      {
        playerId: rosterPlayer(1, "x").playerId,
        guild: { id: RIFT_STUDY_GROUP, name: "Rift Study Group" },
      },
      {
        playerId: rosterPlayer(9, "x").playerId,
        guild: { id: MIDNIGHT_SCRIMS, name: "Midnight Scrims" },
      },
    ],
  });
  const rift = rosterPlayer(2, "Rift");
  const data = roster([both, rift]);

  test("every server by default", () => {
    expect(playersIn(data, undefined)).toHaveLength(2);
  });

  test("a person is in a server if any of their players is", () => {
    expect(playersIn(data, [MIDNIGHT_SCRIMS]).map((p) => p.alias)).toEqual([
      "Both",
    ]);
    expect(playersIn(data, [RIFT_STUDY_GROUP])).toHaveLength(2);
  });
});

describe("playersMatching", () => {
  const first = rosterPlayer(1, "First");
  const second = rosterPlayer(2, "Second");
  const data = roster([first, second]);

  test("keeps the order the search ranked, once per person", () => {
    expect(
      playersMatching(data, [2, 1, 2]).map((player) => player.alias),
    ).toEqual(["Second", "First"]);
  });

  test("leaves out anyone the roster does not hold", () => {
    expect(playersMatching(data, [99, 1])).toEqual([first]);
  });
});

describe("rows", () => {
  test("the rank is Solo/Duo, else Flex, else none", () => {
    expect(rowRank(rosterPlayer(1, "A"))?.rank).toBe("Platinum");
    expect(
      rowRank(
        rosterPlayer(1, "A", {
          rank: {
            solo: null,
            flex: { tier: "gold", division: 2, lp: 5, wins: 1, losses: 1 },
          },
        }),
      )?.rank,
    ).toBe("Gold");
    expect(
      rowRank(rosterPlayer(1, "A", { rank: { solo: null, flex: null } })),
    ).toBeUndefined();
  });

  test("the latest game ends a sentence, and a live game says only the champion", () => {
    expect(latestLine(rosterPlayer(1, "A"), NOW_MS)).toBe(
      "Lost as Thresh, 2 hours ago",
    );
    expect(
      latestLine(
        rosterPlayer(1, "A", {
          latestGame: {
            matchId: matchId(1),
            win: true,
            championId: 157,
            championName: "Yasuo",
            queue: "solo",
            queueId: 420,
            gameCreationMs: NOW_MS - 30 * 3_600_000,
          },
        }),
        NOW_MS,
      ),
    ).toBe("Won as Yasuo, yesterday");
    expect(latestLine(rosterPlayer(1, "A", { live: LIVE_GAME }), NOW_MS)).toBe(
      "as Ahri",
    );
    expect(
      latestLine(rosterPlayer(1, "A", { latestGame: null }), NOW_MS),
    ).toBeUndefined();
  });

  test("the viewer is found by their flag", () => {
    const you = rosterPlayer(3, "You", { isYou: true });
    expect(youIn([rosterPlayer(1, "A"), you])).toBe(you);
    expect(youIn([rosterPlayer(1, "A")])).toBeUndefined();
  });

  test("the viewer's line is their record and streak as one sentence", () => {
    expect(
      youLine(
        rosterPlayer(1, "A", {
          form: {
            games: 20,
            wins: 12,
            streak: { result: "win", games: 3, atLeast: false },
          },
        }),
      ),
    ).toBe("Won 12 of the last 20, and on a 3-game win streak.");
    expect(youLine(rosterPlayer(1, "A"))).toBe("Won 12 of the last 20.");
    expect(youLine(rosterPlayer(1, "A", { form: null }))).toBeUndefined();
  });
});

const names = (count: number) =>
  rosterHero(
    Array.from({ length: count }, (_, index) =>
      rosterPlayer(index + 1, `P${(index + 1).toString()}`, {
        live: LIVE_GAME,
      }),
    ),
  ).lead;

describe("rosterHero", () => {
  test("names the one person in a game, the champion and the queue", () => {
    const hero = rosterHero([
      rosterPlayer(1, "RiverQuartz", { live: LIVE_GAME }),
      rosterPlayer(2, "TidalWren"),
    ]);
    expect(hero.lead).toBe("RiverQuartz is playing right now.");
    expect(hero.sub).toBe("As Ahri in Ranked Solo.");
    expect(hero.art).toBe(103);
  });

  test("counts several players in games", () => {
    expect(names(2)).toBe("P1 and P2 are playing right now.");
    expect(names(4)).toBe("P1 and 3 others are playing right now.");
  });

  test("with nobody in a game it states the week's activity", () => {
    const hero = rosterHero([
      rosterPlayer(1, "A"),
      rosterPlayer(2, "B", { lastSevenDays: { games: 0 } }),
    ]);
    expect(hero.lead).toBe("1 of 2 played this week.");
    expect(hero.sub).toBeUndefined();
    expect(hero.art).toBe(412);
  });
});
