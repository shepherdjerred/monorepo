import type { LeaguePuuid } from "@scout-for-lol/data";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  createChampionPageTestEnv,
  withDiscordOutage,
} from "#src/testing/consumer-champion-test-env.ts";
import {
  expectLakeSlots,
  expectOneLakeSlot,
} from "#src/testing/consumer-profile-feature-test.ts";
import { testPuuid } from "#src/testing/test-ids.ts";
import {
  AHRI,
  HOURS,
  JINX,
  NOW,
  RIVER,
  TIDAL,
  VIEWER_ALT,
  VIEWER_MAIN,
  VIEWER_OTHER_GUILD,
  YASUO,
  lobby,
  matchId,
  mid,
  soloGame,
} from "#src/testing/consumer-champion-group.ts";

const discord = vi.hoisted(() => ({ unavailable: false }));
vi.mock("#src/consumer/access.ts", async (importActual) =>
  withDiscordOutage(await importActual(), discord),
);

const {
  guildId,
  otherGuildId,
  profileFeature,
  trpc,
  caller,
  seedGroup,
  seedPlayer,
  writeLobbies,
} = await createChampionPageTestEnv("trpc-consumer-guild-server", {
  onPrepare: () => {
    discord.unavailable = false;
  },
});

beforeEach(async () => {
  await trpc.prisma.matchRankHistory.deleteMany();
  await trpc.prisma.currentRankSnapshot.deleteMany();
});

function rankJson(tier: string, division: number, lp: number) {
  return JSON.stringify({ tier, division, lp, wins: 10, losses: 10 });
}

async function recordSoloGame(options: {
  n: number;
  puuid: LeaguePuuid;
  hoursAgo: number;
  before: string | null;
  after: string;
}) {
  await trpc.prisma.matchRankHistory.create({
    data: {
      matchId: matchId(options.n),
      puuid: options.puuid,
      queueType: "solo",
      rankBefore: options.before,
      rankAfter: options.after,
      matchGameEndAt: new Date(NOW - options.hoursAgo * HOURS),
      capturedAt: new Date(NOW - options.hoursAgo * HOURS),
    },
  });
}

/**
 * Oldest first. 4h: all three win (Tidal a quadrakill). 3h: the viewer loses
 * while River wins on the other team. 2h: the viewer's second account and River
 * win. 1h: all three win (the viewer a pentakill). A fifth solo game by the
 * viewer's second account is no five-versus-five lobby.
 */
function serverGames() {
  const withMultiKill = (
    entry: ReturnType<typeof lobby>,
    kills: Record<string, number>,
  ) => ({
    ...entry,
    tracked: entry.tracked.map((fact) => ({
      ...fact,
      largestMultiKill: kills[fact.puuid] ?? 2,
    })),
  });
  const top = (who: typeof TIDAL, team: 100 | 200) => ({
    who,
    team,
    position: "TOP" as const,
    champion: YASUO,
    gold15: 5000,
  });
  const bottom = (who: typeof RIVER, team: 100 | 200) => ({
    who,
    team,
    position: "BOTTOM" as const,
    champion: JINX,
    gold15: 5000,
  });
  return [
    withMultiKill(
      lobby({
        n: 4,
        hoursAgo: 4,
        winner: 100,
        seats: [
          mid(VIEWER_MAIN, 100, AHRI, 5000),
          bottom(RIVER, 100),
          top(TIDAL, 100),
        ],
      }),
      { [TIDAL]: 4 },
    ),
    lobby({
      n: 3,
      hoursAgo: 3,
      winner: 200,
      seats: [mid(VIEWER_MAIN, 100, AHRI, 5000), mid(RIVER, 200, AHRI, 5000)],
    }),
    lobby({
      n: 2,
      hoursAgo: 2,
      winner: 100,
      seats: [mid(VIEWER_ALT, 100, AHRI, 5000), bottom(RIVER, 100)],
    }),
    withMultiKill(
      lobby({
        n: 1,
        hoursAgo: 1,
        winner: 100,
        seats: [
          mid(VIEWER_MAIN, 100, AHRI, 5000),
          bottom(RIVER, 100),
          top(TIDAL, 100),
        ],
      }),
      { [VIEWER_MAIN]: 5 },
    ),
  ];
}

async function seedRanksAndClimbs() {
  // The viewer: the main account's latest game is fresher than the alt's
  // snapshot, so Emerald II shows, not Platinum III.
  await recordSoloGame({
    n: 901,
    puuid: VIEWER_MAIN,
    hoursAgo: 1,
    before: rankJson("emerald", 2, 1),
    after: rankJson("emerald", 2, 64),
  });
  await recordSoloGame({
    n: 902,
    puuid: VIEWER_MAIN,
    hoursAgo: 24 * 10,
    before: rankJson("emerald", 3, 10),
    after: rankJson("emerald", 3, 90),
  });
  await trpc.prisma.currentRankSnapshot.create({
    data: {
      puuid: VIEWER_ALT,
      soloRank: rankJson("platinum", 3, 41),
      flexRank: null,
      fetchedAt: new Date(NOW - 72 * HOURS),
    },
  });
  // River: up 20 then down 15, ending Emerald I, 22 LP: a climb of 5.
  await recordSoloGame({
    n: 903,
    puuid: RIVER,
    hoursAgo: 48,
    before: rankJson("emerald", 1, 17),
    after: rankJson("emerald", 1, 37),
  });
  await recordSoloGame({
    n: 904,
    puuid: RIVER,
    hoursAgo: 24,
    before: rankJson("emerald", 1, 37),
    after: rankJson("emerald", 1, 22),
  });
  await trpc.prisma.currentRankSnapshot.create({
    data: {
      puuid: TIDAL,
      soloRank: rankJson("platinum", 1, 80),
      flexRank: null,
      fetchedAt: new Date(NOW - 2 * HOURS),
    },
  });
}

describe("consumerGuild.server: access", () => {
  test("a server without the rollout is forbidden, not unavailable", async () => {
    await expect(
      caller().consumerGuild.server({ guildId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("a server that cannot be confirmed is unavailable, not forbidden", async () => {
    profileFeature.enable(guildId);
    discord.unavailable = true;
    await expect(
      caller().consumerGuild.server({ guildId }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  test("a server outside the viewer's scope is not found", async () => {
    profileFeature.enable(guildId, otherGuildId);
    await expect(
      caller().consumerGuild.server({ guildId: otherGuildId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("a caller with no session is rejected", async () => {
    profileFeature.enable(guildId);
    await expect(
      trpc.anonCaller().consumerGuild.server({ guildId }),
    ).rejects.toThrow();
  });
});

describe("consumerGuild.server: empty states", () => {
  test("a server with no tracked players answers empty and takes no lake slot", async () => {
    profileFeature.enable(guildId);
    const page = await expectLakeSlots(0, () =>
      caller().consumerGuild.server({ guildId }),
    );
    expect(page).toEqual({
      guild: { id: guildId, name: "test-guild" },
      ladder: [],
      awards: {
        biggestClimb: null,
        mostGames: null,
        longestStreak: null,
        playOfTheWeek: null,
      },
      duos: [],
      plays: { champions: [] },
    });
  });

  test("players with no games and no rank are an unranked ladder", async () => {
    profileFeature.enable(guildId);
    await seedGroup();
    const page = await expectOneLakeSlot(() =>
      caller().consumerGuild.server({ guildId }),
    );
    expect(page.ladder.map((rung) => [rung.alias, rung.rank])).toEqual([
      ["Northstar", null],
      ["RiverQuartz", null],
      ["TidalWren", null],
    ]);
    expect(page.awards).toEqual({
      biggestClimb: null,
      mostGames: null,
      longestStreak: null,
      playOfTheWeek: null,
    });
    expect(page.duos).toEqual([]);
    expect(page.plays).toEqual({ champions: [] });
  });
});

describe("consumerGuild.server: the page", () => {
  test("ranks the ladder, hands out the week's awards, and lists duos and plays", async () => {
    profileFeature.enable(guildId, otherGuildId);
    await seedGroup();
    await seedPlayer({
      serverId: guildId,
      alias: "Wick",
      puuids: [testPuuid("server-wick")],
    });
    await writeLobbies(serverGames(), [
      soloGame({
        n: 5,
        hoursAgo: 5,
        puuid: VIEWER_ALT,
        champion: AHRI,
        win: false,
      }),
      // Older than the awards' week: no credit for the week.
      soloGame({ n: 6, hoursAgo: 8 * 24, puuid: TIDAL, champion: JINX }),
    ]);
    await seedRanksAndClimbs();

    const page = await expectOneLakeSlot(() =>
      caller().consumerGuild.server({ guildId }),
    );

    expect(page.guild).toEqual({ id: guildId, name: "test-guild" });
    // River (Emerald I) over the viewer (Emerald II, the fresher account)
    // over Tidal (Platinum I); unranked players last, by name.
    expect(
      page.ladder.map((rung) => [
        rung.place,
        rung.alias,
        rung.isYou,
        rung.rank?.tier,
        rung.rank?.division,
        rung.rank?.lp,
      ]),
    ).toEqual([
      [1, "RiverQuartz", false, "emerald", 1, 22],
      [2, "Northstar", true, "emerald", 2, 64],
      [3, "TidalWren", false, "platinum", 1, 80],
      [4, "Wick", false, undefined, undefined, undefined],
    ]);
    expect(page.awards.biggestClimb).toMatchObject({
      player: { alias: "Northstar", isYou: true },
      lp: 63,
    });
    // The viewer's five games over two accounts, once each.
    expect(page.awards.mostGames).toMatchObject({
      player: { alias: "Northstar" },
      games: 5,
    });
    // River won the 4h, 3h, 2h and 1h games.
    expect(page.awards.longestStreak).toMatchObject({
      player: { alias: "RiverQuartz", isYou: false },
      wins: 4,
    });
    // The viewer's pentakill beats Tidal's older quadrakill.
    expect(page.awards.playOfTheWeek).toEqual({
      player: expect.objectContaining({ alias: "Northstar", isYou: true }),
      matchId: matchId(1),
      championId: AHRI.id,
      championName: "Ahri",
      multiKill: 5,
    });
    // You and River won 3 of 3; you and Tidal 2 of 2; River and Tidal 2 of 2.
    expect(
      page.duos.map((duo) => [
        duo.players.map((player) => player.alias),
        duo.games,
        duo.wins,
      ]),
    ).toEqual([
      [["Northstar", "RiverQuartz"], 3, 3],
      [["Northstar", "TidalWren"], 2, 2],
      [["RiverQuartz", "TidalWren"], 2, 2],
    ]);
    expect(page.duos[0]?.players[0]?.isYou).toBe(true);
    // Ahri five times (the viewer four, River once), Jinx three, Yasuo two.
    expect(page.plays.champions).toEqual([
      { championId: AHRI.id, championName: "Ahri" },
      { championId: JINX.id, championName: "Jinx" },
      { championId: YASUO.id, championName: "Yasuo" },
    ]);
  });

  test("a stable order on a re-read", async () => {
    profileFeature.enable(guildId);
    await seedGroup();
    await writeLobbies(serverGames());
    await seedRanksAndClimbs();
    const first = await caller().consumerGuild.server({ guildId });
    expect(await caller().consumerGuild.server({ guildId })).toEqual(first);
  });

  test("a player on two servers is counted once, in the server asked about", async () => {
    profileFeature.enable(guildId, otherGuildId);
    trpc.setMembership([
      { guildId, asAdmin: false },
      { guildId: otherGuildId, asAdmin: false },
    ]);
    await seedGroup();
    await writeLobbies(serverGames(), [
      soloGame({
        n: 8,
        hoursAgo: 8,
        puuid: VIEWER_OTHER_GUILD,
        champion: AHRI,
      }),
    ]);

    const here = await caller().consumerGuild.server({ guildId });
    expect(here.ladder.filter((rung) => rung.isYou)).toHaveLength(1);
    expect(here.ladder.map((rung) => rung.alias)).not.toContain(
      "Northstar Elsewhere",
    );
    // The other server's account game is not one of this server's four.
    expect(here.awards.mostGames).toMatchObject({ games: 4 });

    const there = await caller().consumerGuild.server({
      guildId: otherGuildId,
    });
    expect(there.ladder.map((rung) => rung.alias)).toEqual([
      "Northstar Elsewhere",
    ]);
    expect(there.awards.mostGames).toMatchObject({
      player: { alias: "Northstar Elsewhere", isYou: true },
      games: 1,
    });
    expect(there.duos).toEqual([]);
  });

  test("games before the week are not awarded", async () => {
    profileFeature.enable(guildId);
    await seedGroup();
    await writeLobbies(
      [],
      [soloGame({ n: 7, hoursAgo: 9 * 24, puuid: RIVER, champion: AHRI })],
    );
    const page = await caller().consumerGuild.server({ guildId });
    expect(page.awards.mostGames).toBeNull();
  });
});
