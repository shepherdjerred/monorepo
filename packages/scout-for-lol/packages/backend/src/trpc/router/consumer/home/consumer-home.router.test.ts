import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { describe, expect, test, vi } from "vitest";
import {
  addFlagOverride,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import { createChampionPageTestEnv } from "#src/testing/consumer-champion-test-env.ts";
import {
  HOURS,
  JINX,
  NOW,
  RIVER,
  TIDAL,
  VIEWER_ALT,
  VIEWER_OTHER_GUILD,
  VIEWER_MAIN,
  AHRI,
  matchId,
} from "#src/testing/consumer-champion-group.ts";
import {
  consumerAccessStub,
  expectOneLakeSlot,
} from "#src/testing/consumer-profile-feature-test.ts";
import { writeTestLake } from "#src/testing/report-lake/test-report-lake.ts";
import type { TestLakeMatchFact } from "#src/testing/report-lake/rows.ts";
import { testPuuid } from "#src/testing/test-ids.ts";

// A Discord lookup that cannot answer is not a denial.
vi.mock("#src/consumer/access.ts", async () => {
  const { stubbedConsumerAccess } =
    await import("#src/testing/consumer-profile-feature-test.ts");
  return await stubbedConsumerAccess();
});

const {
  guildId,
  otherGuildId,
  lakeDir,
  profileFeature,
  trpc,
  caller,
  seedGroup,
  seedPlayer,
} = await createChampionPageTestEnv("trpc-consumer-home");
const { prisma } = trpc;

const OAK = testPuuid("home-oakheart");
const OAK_ALT = testPuuid("home-oakheart-alt");
const QUILLON = testPuuid("home-quillon");
const HALCYON = testPuuid("home-halcyon");
const DAY = 24 * HOURS;
const LIVE_MATCH = RiotMatchIdSchema.parse("NA1_5500000001");
const VIEWER_DISCORD_ID = DiscordAccountIdSchema.parse("300000000000000051");

let seats = 0;
function fact(options: {
  n: number;
  hoursAgo: number;
  puuid: ReturnType<typeof testPuuid>;
  champion?: { id: number; name: string };
  win?: boolean;
  team?: 100 | 200;
  kda?: [number, number, number];
  multiKill?: number;
}): TestLakeMatchFact {
  seats += 1;
  const champion = options.champion ?? AHRI;
  const [kills, deaths, assists] = options.kda ?? [4, 2, 6];
  return {
    playerId: seats,
    participantId: (seats % 10) + 1,
    playerAlias: "Seat",
    matchId: matchId(options.n),
    puuid: options.puuid,
    queue: "solo",
    win: options.win ?? true,
    surrendered: false,
    kills,
    deaths,
    assists,
    teamId: options.team ?? 100,
    teamPosition: "MIDDLE",
    championId: champion.id,
    championName: champion.name,
    gameCreationAt: new Date(NOW - options.hoursAgo * HOURS),
    ...(options.multiKill === undefined
      ? {}
      : { largestMultiKill: options.multiKill }),
  };
}

function rank(tier: string, division: number, lp: number) {
  return JSON.stringify({ tier, division, lp, wins: 30, losses: 20 });
}

let history = 0;
async function rankMove(options: {
  puuid: ReturnType<typeof testPuuid>;
  hoursAgo: number;
  before: string | null;
  after: string;
  queueType?: "solo" | "flex";
}) {
  history += 1;
  const at = new Date(NOW - options.hoursAgo * HOURS);
  await prisma.matchRankHistory.create({
    data: {
      matchId: RiotMatchIdSchema.parse(
        `NA1_9${history.toString().padStart(8, "0")}`,
      ),
      puuid: options.puuid,
      queueType: options.queueType ?? "solo",
      rankBefore: options.before,
      rankAfter: options.after,
      matchGameEndAt: at,
      capturedAt: at,
    },
  });
}

async function writeFacts(facts: TestLakeMatchFact[], both = false) {
  await writeTestLake(lakeDir, {
    serverId: guildId,
    ...(both ? { alsoTrackedBy: [otherGuildId] } : {}),
    matchFacts: facts,
  });
}

async function clearState() {
  await prisma.liveGameRoster.deleteMany();
  await prisma.challengeRunSnapshot.deleteMany();
  await prisma.challengeRun.deleteMany();
  await prisma.challengeTemplateVersion.deleteMany();
  await prisma.challengeTemplate.deleteMany();
  await prisma.currentRankSnapshot.deleteMany();
  await prisma.matchRankHistory.deleteMany();
  resetFlagOverrides("challenge_runs_enabled");
}

async function seedWeek() {
  profileFeature.enable(guildId);
  const { viewer, river, tidal } = await seedGroup();
  const oak = await seedPlayer({
    serverId: guildId,
    alias: "Oakheart",
    puuids: [OAK],
  });
  const quillon = await seedPlayer({
    serverId: guildId,
    alias: "Quillon",
    puuids: [QUILLON],
  });
  const halcyon = await seedPlayer({
    serverId: guildId,
    alias: "Halcyon",
    puuids: [HALCYON],
  });
  await writeFacts([
    // Match 1: the viewer and River win together; River's KDA is exact.
    fact({ n: 1, hoursAgo: 2, puuid: VIEWER_MAIN, champion: AHRI }),
    fact({
      n: 1,
      hoursAgo: 2,
      puuid: RIVER,
      champion: JINX,
      kda: [10, 3, 9],
    }),
    fact({ n: 2, hoursAgo: 2.5, puuid: TIDAL, win: false, team: 200 }),
    // Match 3: River and the viewer on opposite sides.
    fact({ n: 3, hoursAgo: 3, puuid: VIEWER_MAIN, win: false }),
    fact({ n: 3, hoursAgo: 3, puuid: RIVER, team: 200 }),
    fact({ n: 4, hoursAgo: 4, puuid: VIEWER_ALT }),
    // Five straight wins.
    ...[5, 6, 7, 8, 9].map((hoursAgo) =>
      fact({ n: 10 + hoursAgo, hoursAgo, puuid: OAK }),
    ),
    fact({ n: 30, hoursAgo: 30, puuid: QUILLON, multiKill: 5 }),
    // Out of the week.
    fact({ n: 40, hoursAgo: 8 * 24, puuid: TIDAL }),
  ]);
  // Northstar: +63 over two accounts; Halcyon: promoted, +41; Oakheart +38.
  await rankMove({
    puuid: VIEWER_MAIN,
    hoursAgo: 3,
    before: rank("gold", 2, 40),
    after: rank("gold", 2, 61),
  });
  await rankMove({
    puuid: VIEWER_MAIN,
    hoursAgo: 2,
    before: rank("gold", 2, 61),
    after: rank("gold", 2, 82),
  });
  await rankMove({
    puuid: VIEWER_ALT,
    hoursAgo: 4,
    before: rank("silver", 1, 10),
    after: rank("silver", 1, 31),
  });
  await rankMove({
    puuid: HALCYON,
    hoursAgo: 26,
    before: rank("platinum", 2, 90),
    after: rank("platinum", 1, 31),
  });
  await rankMove({
    puuid: OAK,
    hoursAgo: 5,
    before: rank("gold", 3, 10),
    after: rank("gold", 3, 48),
  });
  // Not climbs: a loss, a Flex gain, a placement with nothing before it.
  await rankMove({
    puuid: RIVER,
    hoursAgo: 3,
    before: rank("gold", 1, 50),
    after: rank("gold", 1, 40),
  });
  await rankMove({
    puuid: TIDAL,
    hoursAgo: 3,
    before: rank("gold", 1, 10),
    after: rank("gold", 1, 90),
    queueType: "flex",
  });
  await rankMove({
    puuid: QUILLON,
    hoursAgo: 3,
    before: null,
    after: rank("silver", 4, 20),
  });
  return { viewer, river, tidal, oak, quillon, halcyon };
}

async function seedChallenge(current: number) {
  await seedGroup();
  await prisma.user.create({
    data: {
      discordId: VIEWER_DISCORD_ID,
      discordUsername: "trpc-harness",
      analyticsUserId: "analytics-home-viewer",
    },
  });
  const template = await prisma.challengeTemplate.create({
    data: { authorDiscordId: VIEWER_DISCORD_ID },
  });
  const version = await prisma.challengeTemplateVersion.create({
    data: {
      templateId: template.id,
      version: 1,
      title: "New champions",
      summary: "Win 3 games on a champion you haven't played this act.",
      contractJson: "{}",
      authorDiscordId: VIEWER_DISCORD_ID,
    },
  });
  const run = await prisma.challengeRun.create({
    data: {
      ownerDiscordId: VIEWER_DISCORD_ID,
      templateId: template.id,
      templateVersionId: version.id,
      originalStartAt: new Date(NOW - DAY),
      frozenContractJson: "{}",
    },
  });
  const snapshot = await prisma.challengeRunSnapshot.create({
    data: {
      runId: run.id,
      revision: 1,
      progressJson: JSON.stringify({
        kind: "scalar",
        reducer: "count",
        current,
        target: 3,
        completed: current >= 3,
      }),
      coverageJson: "{}",
    },
  });
  await prisma.challengeRun.update({
    where: { id: run.id },
    data: { currentSnapshotId: snapshot.id },
  });
  return run;
}

describe("consumerHome.overview: access", () => {
  test("a server without the rollout is forbidden, not unavailable", async () => {
    await clearState();
    await expect(caller().consumerHome.overview()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  test("a server that cannot be confirmed is unavailable, not forbidden", async () => {
    await clearState();
    profileFeature.enable(guildId);
    consumerAccessStub.unavailable = true;
    await expect(caller().consumerHome.overview()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });

  test("a caller with no session is rejected", async () => {
    await clearState();
    profileFeature.enable(guildId);
    await expect(trpc.anonCaller().consumerHome.overview()).rejects.toThrow();
  });
});

describe("consumerHome.overview: empty states", () => {
  test("a tracked viewer with no games gets empty lists and no panels of data", async () => {
    await clearState();
    profileFeature.enable(guildId);
    await seedGroup();
    const home = await expectOneLakeSlot(() =>
      caller().consumerHome.overview(),
    );
    expect(home.viewer).toMatchObject({ name: "Northstar" });
    expect(home.guilds).toEqual([{ id: guildId, name: "test-guild" }]);
    expect(home.feed).toEqual([]);
    expect(home.climbers).toEqual([]);
    expect(home.live).toBeNull();
    expect(home.challenge).toBeNull();
    expect(home.you).toMatchObject({
      alias: "Northstar",
      rank: { solo: null, flex: null },
      form: null,
    });
  });

  test("a viewer with no player of their own still sees their friends", async () => {
    await clearState();
    profileFeature.enable(guildId);
    await seedPlayer({
      serverId: guildId,
      alias: "RiverQuartz",
      puuids: [RIVER],
    });
    await writeFacts([
      fact({ n: 1, hoursAgo: 2, puuid: RIVER, champion: JINX }),
    ]);
    const home = await caller().consumerHome.overview();
    expect(home.viewer).toEqual({ name: "trpc-harness", playerId: null });
    expect(home.you).toBeNull();
    expect(home.feed).toMatchObject([
      { kind: "game", alias: "RiverQuartz", withYou: false },
    ]);
  });
});

describe("consumerHome.overview: the week", () => {
  test("the feed is the friends' week, newest first, as sentences' facts", async () => {
    await clearState();
    const { river, tidal, oak, quillon, halcyon } = await seedWeek();
    const home = await expectOneLakeSlot(() =>
      caller().consumerHome.overview(),
    );

    expect(home.feed.map((item) => `${item.kind}:${item.alias}`)).toEqual([
      "game:RiverQuartz",
      "game:TidalWren",
      "game:RiverQuartz",
      "streak:Oakheart",
      "game:Oakheart",
      "game:Oakheart",
      "game:Oakheart",
      "game:Oakheart",
      "game:Oakheart",
      "rankUp:Halcyon",
      "pentakill:Quillon",
    ]);
    expect(home.feed[0]).toMatchObject({
      kind: "game",
      playerId: river.id,
      win: true,
      championName: "Jinx",
      kills: 10,
      deaths: 3,
      assists: 9,
      withYou: true,
      guildIds: [guildId],
    });
    expect(home.feed[1]).toMatchObject({
      playerId: tidal.id,
      win: false,
      withYou: false,
    });
    // The same match on the other side is not "with you".
    expect(home.feed[2]).toMatchObject({ playerId: river.id, withYou: false });
    expect(home.feed[3]).toMatchObject({
      kind: "streak",
      playerId: oak.id,
      games: 5,
      atLeast: false,
    });
    expect(home.feed[9]).toMatchObject({
      kind: "rankUp",
      playerId: halcyon.id,
      queue: "solo",
      rank: { tier: "platinum", division: 1, lp: 31 },
    });
    expect(home.feed[10]).toMatchObject({
      kind: "pentakill",
      playerId: quillon.id,
      championName: "Ahri",
    });
    // The viewer's own games and the eight-day-old game are not in it.
    expect(home.feed.some((item) => item.alias === "Northstar")).toBe(false);
    expect(home.feed.some((item) => item.at < NOW - 7 * DAY)).toBe(false);
  });

  test("climbers add up each person's Solo/Duo LP once, biggest first", async () => {
    await clearState();
    const { viewer, halcyon, oak } = await seedWeek();
    const home = await caller().consumerHome.overview();
    expect(home.climbers).toEqual([
      { playerId: viewer.id, alias: "Northstar", isYou: true, lpDelta: 63 },
      { playerId: halcyon.id, alias: "Halcyon", isYou: false, lpDelta: 41 },
      { playerId: oak.id, alias: "Oakheart", isYou: false, lpDelta: 38 },
    ]);
  });

  test("the You panel counts both accounts' games once and takes the freshest rank", async () => {
    await clearState();
    const { viewer } = await seedWeek();
    await prisma.currentRankSnapshot.create({
      data: {
        puuid: VIEWER_MAIN,
        soloRank: rank("emerald", 2, 64),
        flexRank: rank("platinum", 1, 12),
        fetchedAt: new Date(),
      },
    });
    const home = await caller().consumerHome.overview();
    expect(home.you).toMatchObject({
      playerId: viewer.id,
      rank: {
        solo: { tier: "emerald", division: 2, lp: 64 },
        flex: { tier: "platinum", division: 1, lp: 12 },
      },
      // Matches 1, 3 and 4: three games over the viewer's two accounts.
      form: { games: 3, wins: 2, streak: { result: "win", games: 1 } },
    });
  });

  test("the order does not move between requests", async () => {
    await clearState();
    await seedWeek();
    const first = await caller().consumerHome.overview();
    const second = await caller().consumerHome.overview();
    expect(second).toEqual(first);
  });
});

describe("consumerHome.overview: one person, however many rows", () => {
  test("a friend in two servers with two accounts is one person", async () => {
    await clearState();
    profileFeature.enable(guildId, otherGuildId);
    trpc.setMembership([
      { guildId, asAdmin: false },
      { guildId: otherGuildId, asAdmin: false },
    ]);
    await seedGroup();
    // Oakheart: one account tracked in both servers, plus a second account.
    const first = await seedPlayer({
      serverId: guildId,
      alias: "Oakheart",
      puuids: [OAK, OAK_ALT],
    });
    await seedPlayer({
      serverId: otherGuildId,
      alias: "Oakheart",
      puuids: [OAK],
    });
    await writeFacts(
      [
        fact({ n: 1, hoursAgo: 3, puuid: OAK }),
        fact({ n: 2, hoursAgo: 4, puuid: OAK_ALT }),
        fact({ n: 3, hoursAgo: 5, puuid: VIEWER_OTHER_GUILD }),
      ],
      true,
    );
    await rankMove({
      puuid: OAK,
      hoursAgo: 3,
      before: rank("gold", 3, 10),
      after: rank("gold", 3, 30),
    });
    await rankMove({
      puuid: OAK_ALT,
      hoursAgo: 4,
      before: rank("gold", 3, 30),
      after: rank("gold", 3, 45),
    });
    const home = await caller().consumerHome.overview();
    expect(home.guilds.map((guild) => guild.id).toSorted()).toEqual(
      [guildId, otherGuildId].toSorted(),
    );
    const oakLines = home.feed.filter((item) => item.alias === "Oakheart");
    expect(oakLines.map((item) => item.kind)).toEqual(["game", "game"]);
    expect(oakLines[0]?.guildIds.toSorted()).toEqual(
      [guildId, otherGuildId].toSorted(),
    );
    // The viewer's two Player rows are one person and not a feed line.
    expect(home.feed.some((item) => item.alias.startsWith("Northstar"))).toBe(
      false,
    );
    expect(home.climbers).toEqual([
      { playerId: first.id, alias: "Oakheart", isYou: false, lpDelta: 35 },
    ]);
  });

  test("a server outside the viewer's scope is not read", async () => {
    await clearState();
    profileFeature.enable(guildId);
    await seedGroup();
    await writeFacts(
      [fact({ n: 1, hoursAgo: 2, puuid: VIEWER_OTHER_GUILD })],
      true,
    );
    const home = await caller().consumerHome.overview();
    expect(home.guilds.map((guild) => guild.id)).toEqual([guildId]);
    expect(home.you?.form).toBeNull();
  });
});

describe("consumerHome.overview: limits", () => {
  test("the feed is capped at fifty lines", async () => {
    await clearState();
    profileFeature.enable(guildId);
    await seedPlayer({
      serverId: guildId,
      alias: "RiverQuartz",
      puuids: [RIVER],
    });
    await writeFacts(
      Array.from({ length: 60 }, (_, index) =>
        fact({ n: 100 + index, hoursAgo: 1 + index * 2.5, puuid: RIVER }),
      ),
    );
    const home = await caller().consumerHome.overview();
    expect(home.feed).toHaveLength(50);
    expect(home.feed[0]?.at).toBeGreaterThan(home.feed[49]?.at ?? Infinity);
  });
});

describe("consumerHome.overview: live game and challenge", () => {
  test("the newest live game names the friends in it once", async () => {
    await clearState();
    profileFeature.enable(guildId, otherGuildId);
    trpc.setMembership([
      { guildId, asAdmin: false },
      { guildId: otherGuildId, asAdmin: false },
    ]);
    const { river } = await seedGroup();
    await seedPlayer({
      serverId: otherGuildId,
      alias: "RiverQuartz",
      puuids: [RIVER],
    });
    const startedAt = new Date(Date.now() - 6 * 60_000);
    await prisma.liveGameRoster.create({
      data: {
        riotMatchId: LIVE_MATCH,
        platform: "NA1",
        gameId: "5500000001",
        queueId: 420,
        gameMode: "CLASSIC",
        gameStartedAt: startedAt,
        detectedAt: startedAt,
        expiresAt: new Date(Date.now() + HOURS),
        trackedPuuids: [RIVER],
        participants: [
          {
            puuid: RIVER,
            riotId: "RiverQuartz#NA1",
            teamId: 100,
            championId: AHRI.id,
            spell1Id: 4,
            spell2Id: 14,
            keystoneId: null,
            primaryTreeId: null,
            secondaryTreeId: null,
            lane: "middle",
            rank: null,
            isTracked: true,
          },
        ],
      },
    });
    const home = await caller().consumerHome.overview();
    expect(home.live).toMatchObject({
      riotMatchId: LIVE_MATCH,
      queueId: 420,
      friends: [
        {
          playerId: river.id,
          alias: "RiverQuartz",
          isYou: false,
          championId: AHRI.id,
          lane: "middle",
        },
      ],
    });
    expect(home.live?.startedAt?.getTime()).toBe(startedAt.getTime());
  });

  test("the viewer's active challenge shows as done of total when the flag is on", async () => {
    await clearState();
    profileFeature.enable(guildId);
    const run = await seedChallenge(1);
    const without = await caller().consumerHome.overview();
    expect(without.challenge).toBeNull();

    addFlagOverride("challenge_runs_enabled", true, { server: guildId });
    const enabled = await caller().consumerHome.overview();
    expect(enabled.challenge).toEqual({
      runId: run.id,
      title: "New champions",
      summary: "Win 3 games on a champion you haven't played this act.",
      done: 1,
      total: 3,
    });
    resetFlagOverrides("challenge_runs_enabled");
  });
});
