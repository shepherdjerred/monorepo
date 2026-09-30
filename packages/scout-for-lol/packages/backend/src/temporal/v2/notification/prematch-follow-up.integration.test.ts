import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  IsoInstantSchema,
  NotificationIntentKeySchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/domain/identity/discord.ts";
import { DiscordMessageIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import type { MatchNotificationIntentRecord } from "#src/database/durable/intent-row.ts";
import {
  createTestDatabase,
  testDatabaseModule,
} from "#src/testing/test-database.ts";
import { fullPrematchRosterFixture } from "#src/testing/raw-capture-fixtures.ts";

/**
 * v1's `recordPrematchOutputs`, per delivered V2 prematch channel, against a
 * real Postgres.
 *
 * The pool rows, the compare-and-set append and the parlay's work row are
 * real. What is replaced is everything that leaves the process — the Discord
 * edit behind the refresh, the parlay's Temporal start, the Riot rank read
 * behind the loading screen, the S3 snapshot read — and the analytics
 * capture, which is observed rather than sent.
 */

const { prisma } = createTestDatabase("scout-v2-prematch-follow-up");

vi.mock("#src/database/index.ts", async () => await testDatabaseModule(prisma));

const seen = vi.hoisted(
  (): {
    context: unknown;
    refreshes: { serverId: string; removeComponents: boolean | undefined }[];
    parlays: number;
    outputs: string[];
  } => ({ context: null, refreshes: [], parlays: 0, outputs: [] }),
);

vi.mock("#src/temporal/v2/prematch/prematch-resume.ts", () => ({
  resumeArchivedPrematchContext: () => Promise.resolve(seen.context),
}));
vi.mock("#src/betting/notify/message-refresh.ts", () => ({
  refreshBucksMessages: (input: {
    serverId: string;
    removeComponents?: boolean;
  }) => {
    seen.refreshes.push({
      serverId: input.serverId,
      removeComponents: input.removeComponents,
    });
    return Promise.resolve();
  },
}));
vi.mock("#src/analytics/guild-lifecycle.ts", () => ({
  recordCoreOutputsDelivered: (serverIds: Iterable<string>) => {
    seen.outputs.push(...serverIds);
    return Promise.resolve();
  },
}));
vi.mock("#src/betting/parlays/parlay-generate.ts", () => ({
  // The real enqueue persists the work row keyed by the match and then asks
  // Temporal to start it; the row is what later deliveries find.
  startParlayGeneration: async (input: {
    gameInfo: { platformId: string; gameId: number };
  }) => {
    seen.parlays += 1;
    await prisma.scoutTemporalWork.create({
      data: {
        id: `parlay:${input.gameInfo.platformId}_${input.gameInfo.gameId.toString()}`,
        kind: "parlay-generation",
        payload: "{}",
      },
    });
  },
}));
vi.mock(
  "#src/temporal/v2/notification/prematch-notification.ts",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    buildPrematchLoadingScreenDataV2: () => Promise.resolve(undefined),
  }),
);
vi.mock(
  "#src/temporal/v2/notification-receipts.ts",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    readNotificationArtifactV2: () =>
      Promise.resolve({ artifact: "none", reason: "unsupported-queue" }),
  }),
);

const { afterPrematchDeliveredV2 } =
  await import("#src/temporal/v2/notification/prematch-follow-up.ts");
const { appendPoolMessageRef, recordPoolMessageRefs } =
  await import("#src/betting/markets/pool-open.ts");

const PUUID = LeaguePuuidSchema.parse("a".repeat(78));
const GUILD = DiscordGuildIdSchema.parse("1337623164146155593");
const CHANNELS = ["800000000000000001", "800000000000000002"];
const MATCH_ID = RiotMatchIdSchema.parse("NA1_8100000001");
const PLAYER = DiscordAccountIdSchema.parse("16050917270473909");

function delivered(
  channelId: string,
  messageId: string,
): MatchNotificationIntentRecord {
  return {
    matchId: MATCH_ID,
    intent: {
      key: NotificationIntentKeySchema.parse(
        `prematch-discord:${MATCH_ID}:${channelId}`,
      ),
      kind: "prematch",
      origin: { kind: "live" },
      target: {
        kind: "channel",
        channelId: DiscordChannelIdSchema.parse(channelId),
      },
      freshnessDeadline: IsoInstantSchema.parse("2099-01-01T00:00:00.000Z"),
      createdAt: IsoInstantSchema.parse("2026-09-25T00:00:00.000Z"),
      attemptCount: 1,
      state: {
        kind: "delivered",
        messageId: DiscordMessageIdSchema.parse(messageId),
        deliveredAt: IsoInstantSchema.parse("2026-09-25T00:00:05.000Z"),
      },
    },
  };
}

async function openPool(poolState = "open") {
  await prisma.bucksMatchPool.create({
    data: {
      matchId: MATCH_ID,
      serverId: GUILD,
      detectedAt: new Date(),
      closesAt: new Date(Date.now() + 600_000),
      roster: JSON.stringify({ participants: [] }),
      poolState,
    },
  });
}

async function refsOf(): Promise<unknown> {
  const pool = await prisma.bucksMatchPool.findFirstOrThrow({
    where: { matchId: MATCH_ID, serverId: GUILD },
  });
  return JSON.parse(pool.messageRefs);
}

beforeEach(async () => {
  seen.refreshes = [];
  seen.parlays = 0;
  seen.outputs = [];
  await prisma.scoutTemporalWork.deleteMany();
  await prisma.bucksMatchPool.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.account.deleteMany();
  await prisma.player.deleteMany();
  const now = new Date();
  const player = await prisma.player.create({
    data: {
      alias: "jerred",
      discordId: PLAYER,
      serverId: GUILD,
      creatorDiscordId: PLAYER,
      createdTime: now,
      updatedTime: now,
    },
  });
  for (const channelId of CHANNELS) {
    await prisma.subscription.create({
      data: {
        playerId: player.id,
        channelId: DiscordChannelIdSchema.parse(channelId),
        serverId: GUILD,
        creatorDiscordId: PLAYER,
        createdTime: now,
        updatedTime: now,
      },
    });
  }
  seen.context = {
    riotMatchId: MATCH_ID,
    gameInfo: { ...fullPrematchRosterFixture([PUUID]), gameId: 8_100_000_001 },
    trackedPlayers: [
      {
        alias: "jerred",
        league: { leagueAccount: { puuid: PUUID, region: "AMERICA_NORTH" } },
      },
    ],
  };
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("afterPrematchDeliveredV2", () => {
  test("records the message on its guild's pool, refreshes, enqueues the parlay and counts the output", async () => {
    await openPool();
    const [channel] = CHANNELS;
    if (channel === undefined) throw new Error("channel");

    expect(
      await afterPrematchDeliveredV2(delivered(channel, "900000000000000001")),
    ).toEqual({
      outcome: "completed",
    });

    expect(await refsOf()).toEqual([
      { channelId: channel, messageId: "900000000000000001" },
    ]);
    expect(seen.refreshes).toEqual([
      { serverId: GUILD, removeComponents: false },
    ]);
    expect(seen.parlays).toBe(1);
    expect(seen.outputs).toEqual([GUILD]);
  });

  test("a retried follow-up records nothing twice and enqueues no second parlay", async () => {
    await openPool();
    const [first, second] = CHANNELS;
    if (first === undefined || second === undefined)
      throw new Error("channels");

    await afterPrematchDeliveredV2(delivered(first, "900000000000000001"));
    await afterPrematchDeliveredV2(delivered(first, "900000000000000001"));
    await afterPrematchDeliveredV2(delivered(second, "900000000000000002"));

    expect(await refsOf()).toEqual([
      { channelId: first, messageId: "900000000000000001" },
      { channelId: second, messageId: "900000000000000002" },
    ]);
    expect(seen.parlays).toBe(1);
  });

  test("removes the buttons from a message delivered after its pool closed", async () => {
    await openPool("closed");
    const [channel] = CHANNELS;
    if (channel === undefined) throw new Error("channel");

    await afterPrematchDeliveredV2(delivered(channel, "900000000000000001"));

    expect(seen.refreshes).toEqual([
      { serverId: GUILD, removeComponents: true },
    ]);
  });

  test("counts the output but records no ref for a guild without a pool", async () => {
    const [channel] = CHANNELS;
    if (channel === undefined) throw new Error("channel");

    expect(
      await afterPrematchDeliveredV2(delivered(channel, "900000000000000001")),
    ).toEqual({
      outcome: "completed",
    });

    expect(seen.refreshes).toEqual([]);
    expect(seen.parlays).toBe(0);
    expect(seen.outputs).toEqual([GUILD]);
  });
});

describe("appendPoolMessageRef", () => {
  const refs = Array.from({ length: 6 }, (_unused, index) => ({
    channelId: `80000000000000010${index.toString()}`,
    messageId: `90000000000000000${index.toString()}`,
  }));

  test("keeps every sibling channel's ref when they record at once", async () => {
    await openPool();

    await Promise.all(
      refs.map(
        async (ref) =>
          await appendPoolMessageRef({
            matchId: MATCH_ID,
            serverId: GUILD,
            ref,
            prematchContentBase: "",
          }),
      ),
    );

    expect(await refsOf()).toEqual(expect.arrayContaining(refs));
    expect(await refsOf()).toHaveLength(refs.length);
  });

  test("mutation: the whole-array write it replaces loses concurrent siblings", async () => {
    // The guard under proof is the compare-and-set. v1's whole-array write is
    // what the V2 path would be without it, and it keeps only the last
    // writer — which is why a per-channel V2 follow-up must not use it.
    await openPool();

    await Promise.all(
      refs.map(
        async (ref) =>
          await recordPoolMessageRefs({
            matchId: MATCH_ID,
            serverId: GUILD,
            refs: [ref],
            prematchContentBase: "",
          }),
      ),
    );

    expect(await refsOf()).toHaveLength(1);
  });

  test("answers no-pool for a guild that never got one", async () => {
    expect(
      await appendPoolMessageRef({
        matchId: MATCH_ID,
        serverId: GUILD,
        ref: {
          channelId: "800000000000000001",
          messageId: "900000000000000009",
        },
        prematchContentBase: "",
      }),
    ).toBe("no-pool");
  });
});
