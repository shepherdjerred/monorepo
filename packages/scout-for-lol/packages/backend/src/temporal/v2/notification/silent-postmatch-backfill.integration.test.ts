import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { MatchIdSchema } from "@scout-for-lol/data";
import {
  IsoInstantSchema,
  NotificationIntentKeySchema,
  RiotMatchIdSchema,
  S3ObjectKeySchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import { NotificationIntentSchema } from "@scout-for-lol/domain/notifications/intent.ts";
import type { PipelineOwner } from "@scout-for-lol/domain/match-processing/states.ts";
import {
  SCOUT_V2_MATCH_PHASES,
  SCOUT_V2_MATCH_RECEIPT_KINDS,
  scoutV2MatchStageEvidenceCodec,
} from "@scout-for-lol/temporal/match-receipts-v2";
import type { StoredObject } from "#src/storage/object-integrity.ts";
import { computeSha256Digest } from "#src/storage/object-integrity.ts";
import {
  createTestDatabase,
  testDatabaseModule,
} from "#src/testing/test-database.ts";
import { testChannelId, testGuildId } from "#src/testing/test-ids.ts";

/**
 * The silent post-match backfill against real receipts, intents, claims and
 * rank history, with the world it renders from and the store it commits to
 * stubbed — and every Discord send point wired to fail the test if touched.
 *
 * Pinned: a backfilled match gets the report object and the render receipt a
 * normal run commits, and NO intent, NO Discord effect claim, NO send, and no
 * rewrite of the rank history its settlement captured. A rerun commits
 * nothing twice. Each refusal leaves the store and the receipts untouched.
 *
 * Mutation proof for the silence: add
 * `await mintPostmatchNotificationIntentsV2({ riotMatchId })` (from
 * `match-effects.ts`) before the render in `backfillSilentPostmatchArtifactV2`
 * — the normal run's step this backfill deliberately leaves out — and
 * "renders and attests" fails on the intent count.
 */
const { prisma } = createTestDatabase("scout-v2-silent-postmatch-backfill");

const PUUID = LeaguePuuidSchema.parse("b".repeat(78));
const GAME_CREATION = Date.parse("2026-09-23T04:00:00.000Z");

const world = vi.hoisted(() => ({
  puts: new Array<{ key: string; keyDate: Date | undefined }>(),
  renderOptions: new Array<Record<string, unknown>>(),
  deliverable: 1,
  discordCalls: new Array<string>(),
}));

vi.mock("#src/database/index.ts", async () => await testDatabaseModule(prisma));

// Every place a message can leave for Discord. Reaching any of them from the
// backfill is the bug this file exists to catch, so each records and throws.
function forbidden(name: string): () => never {
  return () => {
    world.discordCalls.push(name);
    throw new Error(`The silent backfill reached Discord through ${name}`);
  };
}
vi.mock("#src/league/discord/channel.ts", () => ({
  send: forbidden("league/discord/channel.send"),
  ChannelSendError: class extends Error {},
  isReplyPermissionError: () => false,
}));
vi.mock("#src/discord/utils/dm.ts", () => ({
  sendDM: forbidden("discord/utils/dm.sendDM"),
}));
vi.mock("#src/discord/utils/channel.ts", () => ({
  fetchChannelForDelivery: forbidden("discord/utils/channel.fetch"),
  asTextChannel: forbidden("discord/utils/channel.asTextChannel"),
}));

vi.mock("#src/temporal/v2/match-context.ts", () => ({
  resolveScoutV2ObservedMatchContext: (riotMatchId: string) =>
    Promise.resolve({
      matchId: riotMatchId,
      riotMatchId,
      matchData: {
        metadata: { matchId: riotMatchId, participants: [PUUID] },
        info: {
          queueId: 420,
          gameMode: "CLASSIC",
          gameType: "MATCHED_GAME",
          gameCreation: GAME_CREATION,
        },
      },
      matchDataSource: "RIOT",
      observedPuuids: [PUUID],
      trackedPlayers: [],
    }),
}));
vi.mock("#src/league/tasks/notification-filters.ts", () => ({
  resolvePostmatchDeliveryChannels: () =>
    Promise.resolve({
      subscribed: [],
      // A real subscribed channel, so a minter handed this audience WOULD
      // mint — which is what lets the mutation proof in the header fail on
      // the intent count rather than on a malformed stub.
      deliverable: Array.from({ length: world.deliverable }, () => ({
        channel: testChannelId("9709"),
        serverId: testGuildId("5"),
        subscriptions: [],
      })),
      guildIds: [testGuildId("5")],
    }),
}));
vi.mock("#src/league/tasks/postmatch/match-report-generator.ts", () => ({
  generateMatchReport: async (
    matchData: { metadata: { matchId: string } },
    _players: unknown,
    options: Record<string, unknown>,
  ) => {
    const { attachReportImage } =
      await import("#src/league/tasks/postmatch/match-report-image.ts");
    world.renderOptions.push(options);
    const [attachment, embed] = attachReportImage(
      new Uint8Array([137, 80, 78, 71, 7]),
      MatchIdSchema.parse(matchData.metadata.matchId),
    );
    return {
      content: "someone finished a game",
      files: [attachment],
      embeds: [embed],
    };
  },
}));
vi.mock("#src/storage/s3-helpers.ts", () => ({
  saveToS3: (config: {
    matchId: string;
    assetType: string;
    body: Uint8Array;
    keyDate?: Date;
  }) => {
    const key = S3ObjectKeySchema.parse(
      `games/2026/09/22/${config.matchId}/${config.assetType}.png`,
    );
    world.puts.push({ key, keyDate: config.keyDate });
    const stored: StoredObject = {
      key,
      digest: computeSha256Digest(config.body),
      bytes: config.body.byteLength,
      contentType: "image/png",
      capturedAt: IsoInstantSchema.parse("2026-09-24T00:00:00.000Z"),
      url: `s3://test/${key}`,
    };
    return Promise.resolve(stored);
  },
}));

const { backfillSilentPostmatchArtifactV2 } =
  await import("#src/temporal/v2/notification/silent-postmatch-backfill.ts");
const { observeMatch } =
  await import("#src/database/durable/observation-repository.ts");
const { recordReceipt } =
  await import("#src/database/durable/receipt-repository.ts");
const { upsertIntent } =
  await import("#src/database/durable/intent-repository.ts");
const { recordTrackedAccounts } =
  await import("#src/database/durable/tracked-account-repository.ts");
const { buildReceipt } = await import("#src/report-lake/durable-receipts.ts");
const { readNotificationArtifactV2 } =
  await import("#src/temporal/v2/notification-receipts.ts");

afterAll(async () => {
  await prisma.$disconnect();
});

const STAGE = "dev" as const;
let matchSequence = 9700;

type Seed = {
  owner?: PipelineOwner;
  deliveryMode?: "live" | "silent-backfill";
  phases?: readonly (typeof SCOUT_V2_MATCH_PHASES)[number][];
  cursorAdvanced?: boolean;
};

/** A match exactly as the mint-less core left it, unless told otherwise. */
async function seedMatch(seed: Seed = {}): Promise<RiotMatchId> {
  matchSequence += 1;
  const matchId = RiotMatchIdSchema.parse(`NA1_${matchSequence.toString()}`);
  await observeMatch(prisma, {
    matchId,
    platformRoute: "NA1",
    policy: "FULL",
    deliveryMode: seed.deliveryMode ?? "live",
    owner: seed.owner ?? { kind: "temporal-v2" },
    promotion: null,
    gameCreatedAt: IsoInstantSchema.parse(
      new Date(GAME_CREATION).toISOString(),
    ),
    observedAt: IsoInstantSchema.parse("2026-09-23T04:40:00.000Z"),
    artifacts: { match: null, timeline: null },
  });
  for (const phase of seed.phases ?? SCOUT_V2_MATCH_PHASES) {
    await recordReceipt(
      prisma,
      buildReceipt({
        matchId,
        kind: SCOUT_V2_MATCH_RECEIPT_KINDS[phase],
        recordedAt: new Date("2026-09-23T04:41:00.000Z"),
        evidence: scoutV2MatchStageEvidenceCodec.serialize({
          riotMatchId: matchId,
          phase,
        }),
      }),
    );
  }
  await recordTrackedAccounts(prisma, [
    {
      matchId,
      puuid: PUUID,
      playerId: null,
      accountId: null,
      cursorAdvancedAt:
        (seed.cursorAdvanced ?? true)
          ? IsoInstantSchema.parse("2026-09-23T04:42:00.000Z")
          : null,
    },
  ]);
  return matchId;
}

const RANK = {
  division: 2,
  tier: "gold",
  lp: 40,
  wins: 10,
  losses: 8,
};

async function seedCapturedRank(matchId: RiotMatchId): Promise<string> {
  const row = await prisma.matchRankHistory.create({
    data: {
      matchId,
      puuid: PUUID,
      queueType: "solo",
      rankBefore: JSON.stringify({ ...RANK, lp: 20 }),
      rankAfter: JSON.stringify(RANK),
      matchGameCreationAt: new Date(GAME_CREATION),
      matchGameEndAt: new Date(GAME_CREATION + 30 * 60_000),
      capturedAt: new Date("2026-09-23T04:41:00.000Z"),
    },
  });
  return JSON.stringify(row);
}

async function durableSideEffects(matchId: RiotMatchId) {
  return {
    intents: await prisma.matchNotificationIntent.count({
      where: { riotMatchId: matchId },
    }),
    discordClaims: await prisma.scoutEffectClaim.count({
      where: { kind: "discord-channel-message" },
    }),
    renderReceipts: await prisma.matchProcessingReceipt.count({
      where: { riotMatchId: matchId, kind: "v2-notification-render-postmatch" },
    }),
  };
}

beforeEach(() => {
  world.puts.length = 0;
  world.renderOptions.length = 0;
  world.deliverable = 1;
  world.discordCalls.length = 0;
});

describe("a match the mint-less core finished", () => {
  test("renders and attests the report, mints no intent, and reaches no Discord", async () => {
    const matchId = await seedMatch();
    const captured = await seedCapturedRank(matchId);

    expect(
      await backfillSilentPostmatchArtifactV2({
        stage: STAGE,
        riotMatchId: matchId,
      }),
    ).toEqual({ outcome: "rendered" });

    // The artifact a normal run commits: the report object, filed under the
    // game's own date, and the receipt naming it.
    expect(world.puts.map((put) => put.key)).toEqual([
      `games/2026/09/22/${matchId}/report.png`,
    ]);
    expect(world.puts[0]?.keyDate).toEqual(new Date(GAME_CREATION));
    const artifact = await readNotificationArtifactV2(matchId, "postmatch");
    expect(artifact).toMatchObject({
      artifact: "report",
      riotMatchId: matchId,
      image: { objectKey: `games/2026/09/22/${matchId}/report.png` },
    });

    // And nothing that could ever announce it.
    expect(await durableSideEffects(matchId)).toEqual({
      intents: 0,
      discordClaims: 0,
      renderReceipts: 1,
    });
    expect(world.discordCalls).toEqual([]);

    // The rank history settlement captured for the game is handed to the
    // generator and left exactly as it was.
    expect(world.renderOptions[0]?.["prefetchedRankChanges"]).toEqual(
      new Map([[PUUID, { before: { ...RANK, lp: 20 }, after: RANK }]]),
    );
    const standing = await prisma.matchRankHistory.findFirstOrThrow({
      where: { matchId },
    });
    expect(JSON.stringify(standing)).toBe(captured);
  });

  test("a rerun renders nothing, writes nothing, and says why", async () => {
    const matchId = await seedMatch();
    await backfillSilentPostmatchArtifactV2({
      stage: STAGE,
      riotMatchId: matchId,
    });
    const receiptsAfterFirst = await prisma.matchProcessingReceipt.findMany({
      where: { riotMatchId: matchId },
      orderBy: { id: "asc" },
    });

    expect(
      await backfillSilentPostmatchArtifactV2({
        stage: STAGE,
        riotMatchId: matchId,
      }),
    ).toEqual({ outcome: "skipped", reason: "already-rendered" });

    expect(world.puts).toHaveLength(1);
    expect(world.renderOptions).toHaveLength(1);
    expect(
      await prisma.matchProcessingReceipt.findMany({
        where: { riotMatchId: matchId },
        orderBy: { id: "asc" },
      }),
    ).toEqual(receiptsAfterFirst);
  });
});

describe("what the backfill refuses, before any effect", () => {
  test.each([
    {
      name: "a match v1 owns",
      seed: { owner: { kind: "legacy-v1" } },
      reason: "not-v2-owned",
    },
    {
      name: "a silent-backfill observation",
      seed: { deliveryMode: "silent-backfill" },
      reason: "observed-silent",
    },
    {
      name: "a core that has not attested every phase",
      seed: { phases: ["archive", "observation"] },
      reason: "core-incomplete",
    },
    {
      name: "a core whose cursor has not advanced",
      seed: { cursorAdvanced: false },
      reason: "core-incomplete",
    },
  ] satisfies readonly { name: string; seed: Seed; reason: string }[])(
    "$name",
    async (scenario) => {
      const matchId = await seedMatch(scenario.seed);

      expect(
        await backfillSilentPostmatchArtifactV2({
          stage: STAGE,
          riotMatchId: matchId,
        }),
      ).toEqual({ outcome: "skipped", reason: scenario.reason });
      expect(world.puts).toEqual([]);
      expect(await durableSideEffects(matchId)).toEqual({
        intents: 0,
        discordClaims: 0,
        renderReceipts: 0,
      });
    },
  );

  test("a match whose postmatch intent stands is the live lane's", async () => {
    const matchId = await seedMatch();
    await upsertIntent(prisma, {
      matchId,
      intent: NotificationIntentSchema.parse({
        key: NotificationIntentKeySchema.parse(
          `postmatch-discord:${matchId}:9701`,
        ),
        kind: "postmatch",
        origin: { kind: "live" },
        target: { kind: "channel", channelId: testChannelId("9701") },
        freshnessDeadline: "2099-01-01T00:00:00.000Z",
        createdAt: "2026-09-23T04:43:00.000Z",
        attemptCount: 0,
        state: { kind: "pending" },
      }),
    });

    expect(
      await backfillSilentPostmatchArtifactV2({
        stage: STAGE,
        riotMatchId: matchId,
      }),
    ).toEqual({ outcome: "skipped", reason: "postmatch-intent-standing" });
    expect(world.puts).toEqual([]);
  });

  test("a match with no deliverable channel renders nothing, as a normal run did", async () => {
    const matchId = await seedMatch();
    world.deliverable = 0;

    expect(
      await backfillSilentPostmatchArtifactV2({
        stage: STAGE,
        riotMatchId: matchId,
      }),
    ).toEqual({ outcome: "skipped", reason: "no-deliverable-channel" });
    expect(world.puts).toEqual([]);
    const effects = await durableSideEffects(matchId);
    expect(effects.renderReceipts).toBe(0);
  });

  test("a match the pipeline never observed fails non-retryably", async () => {
    await expect(
      backfillSilentPostmatchArtifactV2({
        stage: STAGE,
        riotMatchId: RiotMatchIdSchema.parse("NA1_1"),
      }),
    ).rejects.toMatchObject({
      type: "MissingDomainRecord",
      nonRetryable: true,
    });
  });
});
