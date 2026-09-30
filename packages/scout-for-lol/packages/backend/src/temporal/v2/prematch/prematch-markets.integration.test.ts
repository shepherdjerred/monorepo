import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import type {
  PlayerConfigEntry,
  RawCurrentGameInfo,
} from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  type DiscordGuildId,
} from "@scout-for-lol/domain/identity/discord.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import {
  createTestDatabase,
  testDatabaseModule,
} from "#src/testing/test-database.ts";
import { fullPrematchRosterFixture } from "#src/testing/raw-capture-fixtures.ts";

/**
 * The V2 prematch Bryan Bucks effect against a real Postgres.
 *
 * What is under test is once-only: per match and guild, across retries of
 * the Activity AND across the two pipelines during an ownership flip. The
 * fence, the claim row, the receipt, `BucksMatchPool`'s unique (match, guild)
 * and the Classic marker's guarded claim are all real here; only the archived
 * snapshot read (S3) is replaced by the context it would return.
 *
 * Each "mutation" test names the guard it proves: remove that guard and the
 * assertion it carries fails. They were run against the mutated code while
 * this suite was written.
 */

const { prisma } = createTestDatabase("scout-v2-prematch-markets");

vi.mock("#src/database/index.ts", async () => await testDatabaseModule(prisma));

const archived = vi.hoisted((): { context: unknown } => ({ context: null }));
vi.mock("#src/temporal/v2/prematch/prematch-resume.ts", () => ({
  resumeArchivedPrematchContext: () => Promise.resolve(archived.context),
}));

const { openPrematchMarketsV2, PREMATCH_MARKETS_RECEIPT_KIND } =
  await import("#src/temporal/v2/prematch/prematch-markets.ts");
const { mintPrematchIntent } =
  await import("#src/temporal/v2/prematch/prematch-intents.ts");
const { prepareBucksPrematch } =
  await import("#src/betting/markets/prematch-hook.ts");
const { readMatchReceiptEvidenceV2 } =
  await import("#src/temporal/v2/match-commits.ts");
const { addFlagOverride, clearFlagOverrides, resetFlagOverrides } =
  await import("#src/configuration/flags.ts");

const PUUID = LeaguePuuidSchema.parse("a".repeat(78));
const GUILD = DiscordGuildIdSchema.parse("1337623164146155593");
const OTHER_GUILD = DiscordGuildIdSchema.parse("2337623164146155593");
const CHANNELS = ["700000000000000001", "700000000000000002"];
const OTHER_CHANNEL = "700000000000000003";
const PLAYER = DiscordAccountIdSchema.parse("16050917270473909");
const SOLO_MATCH = RiotMatchIdSchema.parse("NA1_7100000001");
const CLASSIC_MATCH = RiotMatchIdSchema.parse("NA1_7100000002");

function trackedPlayer(): PlayerConfigEntry {
  return {
    alias: "jerred",
    league: { leagueAccount: { puuid: PUUID, region: "AMERICA_NORTH" } },
  };
}

function gameFor(riotMatchId: string, queueId: number): RawCurrentGameInfo {
  return {
    // Every seat a real puuid: a pool's frozen roster parses each one.
    ...fullPrematchRosterFixture([
      PUUID,
      ...Array.from({ length: 9 }, (_unused, index) =>
        `p${index.toString()}`.padEnd(78, "x"),
      ),
    ]),
    gameId: Number(riotMatchId.split("_")[1]),
    gameQueueConfigId: queueId,
    gameStartTime: Date.now(),
  };
}

async function register(serverId: DiscordGuildId, channelIds: string[]) {
  const now = new Date();
  const player = await prisma.player.create({
    data: {
      alias: "jerred",
      discordId: PLAYER,
      serverId,
      creatorDiscordId: PLAYER,
      createdTime: now,
      updatedTime: now,
    },
  });
  await prisma.account.create({
    data: {
      alias: "jerred",
      puuid: PUUID,
      region: "AMERICA_NORTH",
      playerId: player.id,
      serverId,
      creatorDiscordId: PLAYER,
      createdTime: now,
      updatedTime: now,
    },
  });
  for (const channelId of channelIds) {
    await prisma.subscription.create({
      data: {
        playerId: player.id,
        channelId: DiscordChannelIdSchema.parse(channelId),
        serverId,
        creatorDiscordId: PLAYER,
        createdTime: now,
        updatedTime: now,
      },
    });
  }
}

async function capture(
  riotMatchId: typeof SOLO_MATCH,
  queueId: number,
  channelIds: string[],
): Promise<RawCurrentGameInfo> {
  const gameInfo = gameFor(riotMatchId, queueId);
  archived.context = {
    riotMatchId,
    gameInfo,
    trackedPlayers: [trackedPlayer()],
  };
  const observedAt = new Date();
  for (const channelId of channelIds) {
    await mintPrematchIntent(prisma, {
      matchId: riotMatchId,
      channelId,
      createdAt: observedAt,
      freshnessDeadline: new Date(observedAt.getTime() + 3_600_000),
    });
  }
  return gameInfo;
}

beforeEach(async () => {
  await prisma.scoutEffectClaim.deleteMany();
  await prisma.matchProcessingReceipt.deleteMany();
  await prisma.matchNotificationIntent.deleteMany();
  await prisma.bucksLedgerEntry.deleteMany();
  await prisma.bucksMatchEarning.deleteMany();
  await prisma.bucksAccount.deleteMany();
  await prisma.bucksMatchPool.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.account.deleteMany();
  await prisma.player.deleteMany();
  clearFlagOverrides("betting_enabled");
  addFlagOverride("betting_enabled", true, { server: GUILD });
});

afterEach(() => {
  resetFlagOverrides("betting_enabled");
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("openPrematchMarketsV2 — betting pools", () => {
  test("opens one pool per Bucks-enabled announced guild, once, and receipts it", async () => {
    await register(GUILD, CHANNELS);
    await register(OTHER_GUILD, [OTHER_CHANNEL]);
    await capture(SOLO_MATCH, 420, [...CHANNELS, OTHER_CHANNEL]);

    const first = await openPrematchMarketsV2({ riotMatchId: SOLO_MATCH });
    const second = await openPrematchMarketsV2({ riotMatchId: SOLO_MATCH });

    expect(first).toEqual({
      guard: { outcome: "applied" },
      fact: { outcome: "applied" },
      effects: 1,
    });
    // The completed claim skips the effect outright.
    expect(second).toEqual({
      guard: { outcome: "already-applied" },
      fact: { outcome: "already-applied" },
      effects: 0,
    });
    // Two channels in GUILD, one guild pool; OTHER_GUILD has Bucks off.
    const pools = await prisma.bucksMatchPool.findMany({
      where: { matchId: SOLO_MATCH },
    });
    expect(pools.map((pool) => pool.serverId)).toEqual([GUILD]);
    expect(
      await readMatchReceiptEvidenceV2(
        SOLO_MATCH,
        PREMATCH_MARKETS_RECEIPT_KIND,
      ),
    ).toEqual({
      kind: "prematch-markets-evidence",
      version: 1,
      data: { market: "betting-pools", guildIds: [GUILD] },
    });
  });

  test("mutation: a takeover after a lost claim does not open a second pool", async () => {
    // Guard under proof: BucksMatchPool's unique (match, guild). The claim is
    // wiped as if the attempt that opened the pool died before completing
    // it; with the unique constraint or its catch removed, the re-run creates
    // a second pool or throws.
    await register(GUILD, CHANNELS);
    await capture(SOLO_MATCH, 420, CHANNELS);
    await openPrematchMarketsV2({ riotMatchId: SOLO_MATCH });
    await prisma.scoutEffectClaim.deleteMany();
    await prisma.matchProcessingReceipt.deleteMany();

    const retaken = await openPrematchMarketsV2({ riotMatchId: SOLO_MATCH });

    expect(retaken.fact).toEqual({ outcome: "applied" });
    expect(
      await prisma.bucksMatchPool.count({ where: { matchId: SOLO_MATCH } }),
    ).toBe(1);
  });

  test("mutation: v1 announcing the same game after a flip reuses V2's pool", async () => {
    // Guard under proof: the same unique constraint, reached through v1's own
    // open. The window must not move either: v1's create loses, so the pool
    // V2 opened keeps its closesAt.
    await register(GUILD, CHANNELS);
    const gameInfo = await capture(SOLO_MATCH, 420, CHANNELS);
    await openPrematchMarketsV2({ riotMatchId: SOLO_MATCH });
    const before = await prisma.bucksMatchPool.findFirstOrThrow({
      where: { matchId: SOLO_MATCH },
    });

    const v1 = await prepareBucksPrematch(
      {
        gameInfo,
        trackedPlayers: [trackedPlayer()],
        queueType: "solo",
        targetGuildIds: [GUILD],
        detectedAt: new Date(Date.now() + 60_000),
      },
      prisma,
    );

    expect([...v1.bettingGuildIds]).toEqual([GUILD]);
    const after = await prisma.bucksMatchPool.findMany({
      where: { matchId: SOLO_MATCH },
    });
    expect(after).toHaveLength(1);
    expect(after[0]?.closesAt).toEqual(before.closesAt);
  });

  test("opens no market for a game nobody is announced in", async () => {
    await capture(SOLO_MATCH, 420, []);

    const result = await openPrematchMarketsV2({ riotMatchId: SOLO_MATCH });

    expect(result.effects).toBe(0);
    expect(await prisma.bucksMatchPool.count()).toBe(0);
  });
});

describe("openPrematchMarketsV2 — Classic participation", () => {
  test("grants the participation point once and opens no market", async () => {
    await register(GUILD, CHANNELS);
    await capture(CLASSIC_MATCH, 4310, CHANNELS);

    await openPrematchMarketsV2({ riotMatchId: CLASSIC_MATCH });
    await openPrematchMarketsV2({ riotMatchId: CLASSIC_MATCH });

    expect(
      await prisma.bucksLedgerEntry.count({ where: { kind: "earn_game" } }),
    ).toBe(1);
    expect(await prisma.bucksMatchPool.count()).toBe(0);
    expect(
      await readMatchReceiptEvidenceV2(
        CLASSIC_MATCH,
        PREMATCH_MARKETS_RECEIPT_KIND,
      ),
    ).toMatchObject({
      data: { market: "classic-participation", guildIds: [GUILD] },
    });
  });

  test("grants it even when no channel is announced, as v1 does", async () => {
    // The reward is a wallet operation, not a delivery one: v1 grants it
    // before it looks at a single subscription.
    await register(GUILD, []);
    await capture(CLASSIC_MATCH, 4310, []);

    await openPrematchMarketsV2({ riotMatchId: CLASSIC_MATCH });

    expect(
      await prisma.bucksLedgerEntry.count({ where: { kind: "earn_game" } }),
    ).toBe(1);
  });

  test("mutation: neither a lost V2 claim nor v1 after a flip pays twice", async () => {
    // Guard under proof: the BucksMatchEarning marker's guarded
    // pending → processing claim. Remove it and the takeover or v1 pays a
    // second point.
    await register(GUILD, CHANNELS);
    const gameInfo = await capture(CLASSIC_MATCH, 4310, CHANNELS);
    await openPrematchMarketsV2({ riotMatchId: CLASSIC_MATCH });
    await prisma.scoutEffectClaim.deleteMany();
    await prisma.matchProcessingReceipt.deleteMany();

    await openPrematchMarketsV2({ riotMatchId: CLASSIC_MATCH });
    await prepareBucksPrematch(
      {
        gameInfo,
        trackedPlayers: [trackedPlayer()],
        queueType: "classic",
        targetGuildIds: [],
        detectedAt: new Date(),
      },
      prisma,
    );

    expect(
      await prisma.bucksLedgerEntry.count({ where: { kind: "earn_game" } }),
    ).toBe(1);
  });
});
