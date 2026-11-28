import { describe, expect, test } from "vitest";
import { createChampionPageTestEnv } from "#src/testing/consumer-champion-test-env.ts";
import { writeTestLake } from "#src/testing/report-lake/test-report-lake.ts";
import {
  AHRI,
  GAREN,
  HOURS,
  NOW,
  RIVER,
  SYNDRA,
  YASUO,
  groupGames,
  lobby,
  matchId,
  mid,
  soloGame,
} from "#src/testing/consumer-champion-group.ts";

const {
  guildId,
  otherGuildId,
  lakeDir,
  profileFeature,
  trpc,
  caller,
  seedGroup,
  writeLobbies,
} = await createChampionPageTestEnv("trpc-consumer-champion-matchups");

describe("consumerChampion.matchups", () => {
  test("tallies each opponent for the viewer and friends, with the games a lane result rests on", async () => {
    profileFeature.enable(guildId);
    await seedGroup();
    await writeLobbies(groupGames());

    const result = await caller().consumerChampion.matchups({
      championId: AHRI.id,
      lane: "middle",
    });
    expect(result.champion).toEqual({ championId: AHRI.id, name: "Ahri" });
    expect(result.lane).toBe("middle");
    expect(result.matchups).toEqual([
      {
        opponent: { championId: SYNDRA.id, name: "Syndra" },
        games: 3,
        // 1h win and ahead, 2h loss and behind, 7h win with no 15:00 frame.
        you: { games: 3, wins: 2, ahead15: { games: 2, ahead: 1 } },
        friends: null,
      },
      {
        opponent: { championId: YASUO.id, name: "Yasuo" },
        games: 2,
        you: null,
        // 3h win on the red side, ahead; 4h loss with no timeline.
        friends: { games: 2, wins: 1, ahead15: { games: 1, ahead: 1 } },
      },
    ]);
  });

  test("reads the lane asked for and the servers asked for", async () => {
    profileFeature.enable(guildId, otherGuildId);
    trpc.setMembership([
      { guildId, asAdmin: false },
      { guildId: otherGuildId, asAdmin: false },
    ]);
    await seedGroup();
    await writeLobbies(groupGames());

    const top = await caller().consumerChampion.matchups({
      championId: AHRI.id,
      lane: "top",
    });
    expect(top.matchups).toEqual([
      {
        opponent: { championId: GAREN.id, name: "Garen" },
        games: 1,
        you: null,
        friends: { games: 1, wins: 1, ahead15: { games: 1, ahead: 1 } },
      },
    ]);
    const bothServers = await caller().consumerChampion.matchups({
      championId: AHRI.id,
      lane: "middle",
    });
    const scoped = await caller().consumerChampion.matchups({
      championId: AHRI.id,
      lane: "middle",
      guildIds: [guildId],
    });
    // The viewer's account on the other server adds a Syndra game, once.
    expect(bothServers.matchups[0]?.you?.games).toBe(4);
    expect(scoped.matchups[0]?.you?.games).toBe(3);
    // A lane nobody played Ahri in has no matchups.
    await expect(
      caller().consumerChampion.matchups({
        championId: AHRI.id,
        lane: "support",
      }),
    ).resolves.toMatchObject({ matchups: [] });
  });

  test("sorts by games and breaks ties by name", async () => {
    profileFeature.enable(guildId);
    await seedGroup();
    await writeLobbies([
      lobby({
        n: 1,
        hoursAgo: 1,
        winner: 100,
        seats: [mid(RIVER, 100, AHRI, 5000), mid(null, 200, YASUO, 5000)],
      }),
      lobby({
        n: 2,
        hoursAgo: 2,
        winner: 100,
        seats: [mid(RIVER, 100, AHRI, 5000), mid(null, 200, SYNDRA, 5000)],
      }),
    ]);
    const first = await caller().consumerChampion.matchups({
      championId: AHRI.id,
      lane: "middle",
    });
    expect(first.matchups.map((entry) => entry.opponent.name)).toEqual([
      "Syndra",
      "Yasuo",
    ]);
    expect(
      await caller().consumerChampion.matchups({
        championId: AHRI.id,
        lane: "middle",
      }),
    ).toEqual(first);
  });
});

describe("consumerChampion.compare last10", () => {
  test("lists the newest games first with their ids, at most ten", async () => {
    profileFeature.enable(guildId);
    await seedGroup();
    await writeTestLake(lakeDir, {
      serverId: guildId,
      matchFacts: Array.from({ length: 12 }, (_, index) =>
        soloGame({
          n: 200 + index,
          hoursAgo: index + 1,
          puuid: RIVER,
          champion: AHRI,
          win: index % 3 !== 0,
        }),
      ),
    });
    const { rows } = await caller().consumerChampion.compare({
      championId: AHRI.id,
      cohort: "qualified",
    });
    const river = rows.find((row) => row.alias === "RiverQuartz");
    expect(river?.games).toBe(12);
    expect(river?.last10).toHaveLength(10);
    expect(river?.last10.map((game) => game.matchId)).toEqual(
      Array.from({ length: 10 }, (_, index) => matchId(200 + index)),
    );
    expect(river?.last10.map((game) => game.win)).toEqual(
      Array.from({ length: 10 }, (_, index) => index % 3 !== 0),
    );
    expect(river?.last10[0]?.playedAtMs).toBe(NOW - HOURS);
  });

  test("merges a player's accounts into one ordered list", async () => {
    profileFeature.enable(guildId);
    await seedGroup();
    await writeLobbies(groupGames());
    const { rows } = await caller().consumerChampion.compare({
      championId: AHRI.id,
      cohort: "small_sample",
    });
    const viewer = rows.find((row) => row.viewerLinked);
    expect(viewer?.last10.map((game) => [game.matchId, game.win])).toEqual([
      [matchId(1), true],
      [matchId(2), false],
      [matchId(7), true],
    ]);
  });
});
