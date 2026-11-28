import { describe, expect, test } from "vitest";
import { deriveTestLaneResults } from "#src/testing/report-lake/test-lane-results.ts";
import { createChampionPageTestEnv } from "#src/testing/consumer-champion-test-env.ts";
import {
  expectLakeSlots,
  expectOneLakeSlot,
} from "#src/testing/consumer-profile-feature-test.ts";
import {
  AHRI,
  HOURS,
  NOW,
  RIVER,
  SYNDRA,
  VIEWER_MAIN,
  YASUO,
  groupGames,
  lobby,
  matchId,
  mid,
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
} = await createChampionPageTestEnv("trpc-consumer-champion-matchup");

const ahriIntoSyndra = {
  championId: AHRI.id,
  opponentChampionId: SYNDRA.id,
  lane: "middle",
} as const;

/** The group's games, with `lane_results` derived as a rebuild would. */
async function writeDerivedLobbies(lobbies = groupGames()) {
  await writeLobbies(lobbies);
  await deriveTestLaneResults(lakeDir);
}

describe("consumerChampion.matchup", () => {
  test("states the viewer's record and ahead at 15 over the games with a checkpoint", async () => {
    profileFeature.enable(guildId);
    await seedGroup();
    await writeDerivedLobbies();

    const result = await caller().consumerChampion.matchup(ahriIntoSyndra);
    expect(result).toMatchObject({
      status: "available",
      champion: { championId: AHRI.id, name: "Ahri" },
      opponent: { championId: SYNDRA.id, name: "Syndra" },
      lane: "middle",
      // 1h win and ahead (main), 2h loss and behind (alt), 7h win in a game
      // that ended before 15:00, which has no checkpoint to be ahead at.
      you: { games: 3, wins: 2, ahead15: { games: 2, ahead: 1 } },
      friends: { games: 0, wins: 0, ahead15: { games: 0, ahead: 0 } },
    });
  });

  test("lists the viewer's newest games with their scoreline, standing at 15 and LP", async () => {
    profileFeature.enable(guildId);
    const { prisma } = trpc;
    await seedGroup();
    await prisma.matchRankHistory.create({
      data: {
        matchId: matchId(1),
        puuid: VIEWER_MAIN,
        queueType: "solo",
        rankBefore: JSON.stringify({
          tier: "gold",
          division: 2,
          lp: 46,
          wins: 41,
          losses: 34,
        }),
        rankAfter: JSON.stringify({
          tier: "gold",
          division: 2,
          lp: 64,
          wins: 42,
          losses: 34,
        }),
        capturedAt: new Date(NOW),
      },
    });
    await writeDerivedLobbies();

    const result = await caller().consumerChampion.matchup(ahriIntoSyndra);
    if (result.status !== "available") throw new Error("expected lane data");
    expect(result.recent).toEqual([
      {
        matchId: matchId(1),
        win: true,
        playedAtMs: NOW - HOURS,
        kills: 5,
        deaths: 3,
        assists: 7,
        at15: "ahead",
        lpDelta: 18,
      },
      {
        matchId: matchId(2),
        win: false,
        playedAtMs: NOW - 2 * HOURS,
        kills: 5,
        deaths: 3,
        assists: 7,
        at15: "behind",
        lpDelta: null,
      },
      {
        matchId: matchId(7),
        win: true,
        playedAtMs: NOW - 7 * HOURS,
        kills: 5,
        deaths: 3,
        assists: 7,
        at15: null,
        lpDelta: null,
      },
    ]);
  });

  test("keeps the friends' record apart from the viewer's", async () => {
    profileFeature.enable(guildId);
    await seedGroup();
    await writeDerivedLobbies();

    const result = await caller().consumerChampion.matchup({
      championId: AHRI.id,
      opponentChampionId: YASUO.id,
      lane: "middle",
    });
    expect(result).toMatchObject({
      status: "available",
      you: { games: 0, wins: 0, ahead15: { games: 0, ahead: 0 } },
      // 3h River wins and is ahead; 4h River loses with no timeline.
      friends: { games: 2, wins: 1, ahead15: { games: 1, ahead: 1 } },
      recent: [],
    });
  });

  test("a level lane is not ahead, and a game under 15 minutes has no standing", async () => {
    profileFeature.enable(guildId);
    await seedGroup();
    await writeDerivedLobbies([
      lobby({
        n: 20,
        hoursAgo: 1,
        winner: 100,
        seats: [
          mid(VIEWER_MAIN, 100, AHRI, 5000),
          mid(null, 200, SYNDRA, 5000),
        ],
      }),
      lobby({
        n: 21,
        hoursAgo: 2,
        winner: 100,
        timeline: "ended-before-15",
        seats: [
          mid(VIEWER_MAIN, 100, AHRI, 9000),
          mid(null, 200, SYNDRA, 1000),
        ],
      }),
      lobby({
        n: 22,
        hoursAgo: 3,
        winner: 100,
        seats: [
          mid(VIEWER_MAIN, 100, AHRI, 5001),
          mid(null, 200, SYNDRA, 5000),
        ],
      }),
    ]);

    const result = await caller().consumerChampion.matchup(ahriIntoSyndra);
    if (result.status !== "available") throw new Error("expected lane data");
    expect(result.you).toEqual({
      games: 3,
      wins: 3,
      // The 14:30 game is in the record but not in the ahead figure.
      ahead15: { games: 2, ahead: 1 },
    });
    expect(result.recent.map((game) => game.at15)).toEqual([
      "even",
      null,
      "ahead",
    ]);
  });

  test("counts a person once across accounts and servers", async () => {
    profileFeature.enable(guildId, otherGuildId);
    trpc.setMembership([
      { guildId, asAdmin: false },
      { guildId: otherGuildId, asAdmin: false },
    ]);
    await seedGroup();
    await writeDerivedLobbies();

    const bothServers = await caller().consumerChampion.matchup(ahriIntoSyndra);
    const scoped = await caller().consumerChampion.matchup({
      ...ahriIntoSyndra,
      guildIds: [guildId],
    });
    // The viewer's main and alt accounts are one person (3 games); their
    // account on the second server adds the 8h game, once.
    expect(bothServers).toMatchObject({ you: { games: 4 } });
    expect(scoped).toMatchObject({ you: { games: 3 } });
    expect(await caller().consumerChampion.matchup(ahriIntoSyndra)).toEqual(
      bothServers,
    );
  });

  test("a lane nobody played the pairing in is available and empty", async () => {
    profileFeature.enable(guildId);
    await seedGroup();
    await writeDerivedLobbies();

    const result = await caller().consumerChampion.matchup({
      ...ahriIntoSyndra,
      lane: "support",
    });
    expect(result).toMatchObject({
      status: "available",
      you: { games: 0 },
      friends: { games: 0 },
      recent: [],
    });
  });

  test("reads the whole page on one lake slot", async () => {
    profileFeature.enable(guildId);
    await seedGroup();
    await writeDerivedLobbies();
    const result = await expectOneLakeSlot(
      async () => await caller().consumerChampion.matchup(ahriIntoSyndra),
    );
    expect(result.status).toBe("available");
  });
});

describe("consumerChampion.matchup gating and access", () => {
  test("is unavailable while the lake predates lane_results", async () => {
    profileFeature.enable(guildId);
    await seedGroup();
    // No derivation: the test lake models the migration's predecessor build.
    await writeLobbies(groupGames());
    const result = await expectOneLakeSlot(
      async () => await caller().consumerChampion.matchup(ahriIntoSyndra),
    );
    expect(result).toEqual({ status: "unavailable", reason: "lane-data" });
  });

  test("is unavailable when the current build derived no lane rows", async () => {
    profileFeature.enable(guildId);
    await seedGroup();
    await writeLobbies(groupGames());
    await deriveTestLaneResults(lakeDir, { derive: false });
    expect(await caller().consumerChampion.matchup(ahriIntoSyndra)).toEqual({
      status: "unavailable",
      reason: "lane-data",
    });
  });

  test("is forbidden for a server outside the viewer's scope, before the lake", async () => {
    profileFeature.enable(guildId);
    await seedGroup();
    await writeDerivedLobbies();
    await expectLakeSlots(0, async () => {
      await expect(
        caller().consumerChampion.matchup({
          ...ahriIntoSyndra,
          guildIds: [otherGuildId],
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  test("is forbidden when no shared server has the feature", async () => {
    await seedGroup();
    await writeDerivedLobbies();
    await expect(
      caller().consumerChampion.matchup(ahriIntoSyndra),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("a friend's matchup record", () => {
  test("is the friend's own, from the lane they played", async () => {
    profileFeature.enable(guildId);
    await seedGroup();
    await writeDerivedLobbies([
      lobby({
        n: 30,
        hoursAgo: 1,
        winner: 200,
        seats: [mid(null, 100, YASUO, 5000), mid(RIVER, 200, AHRI, 6000)],
      }),
    ]);
    const result = await caller().consumerChampion.matchup({
      championId: YASUO.id,
      opponentChampionId: AHRI.id,
      lane: "middle",
    });
    // Yasuo's row belongs to a stranger, so nobody in scope has a game.
    expect(result).toMatchObject({
      status: "available",
      you: { games: 0 },
      friends: { games: 0 },
    });
  });
});
