import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  MatchIdSchema,
  RankSchema,
  LeaguePuuidSchema,
} from "@scout-for-lol/data";
import {
  NotificationIntentKeySchema,
  RiotMatchIdSchema,
  S3ObjectKeySchema,
  Sha256DigestSchema,
  type NotificationIntentKey,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  NotificationAttemptNonceSchema,
  NotificationIntentSchema,
} from "@scout-for-lol/domain/notifications/intent.ts";
import type * as S3RawSourceModule from "#src/report-store/s3-raw-source.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testChannelId } from "#src/testing/test-ids.ts";
import { upsertIntent } from "#src/database/durable/intent-repository.ts";
import { recordReceipt } from "#src/database/durable/receipt-repository.ts";

/**
 * What a post-match delivery is allowed to leave behind in the database.
 *
 * Nothing. The message is assembled from the render receipt and the objects
 * it names, so a send establishes no new fact about the match — and that is
 * what this suite proves against real rows rather than against a stub.
 *
 * The finding it closes: the delivery ran v1's report generator, which
 * refetches the player's CURRENT rank and upserts this match's
 * `MatchRankHistory` with it as `rankAfter`. Every channel ran that path, so
 * a delivery driven after the player's next game — a reconciliation sweep,
 * days later — silently rewrote the rank the render had captured. The
 * historical row said the player ended this match at the rank they happen to
 * hold now.
 *
 * Mutation proof: put the generator back on the delivery path (call
 * `generateMatchReport` inside `buildAttestedMessage`'s `postmatch` arm) and
 * the stand-in below runs, rewriting `rankAfter` — "leaves the rank captured
 * at render untouched" fails on the rewritten LP.
 */
const testDatabase = createTestDatabase("temporal-v2-notification-delivery");
Bun.env["DATABASE_URL"] = testDatabase.dbUrl;
const { prisma } = testDatabase;

const MATCH = "NA1_9501";
const PUUID = LeaguePuuidSchema.parse("p".repeat(78));
const IMAGE = new Uint8Array([137, 80, 78, 71, 5, 5]);
const CONTENT = "jerred finished a solo game";

/** The rank the render captured, and the one the player holds today. */
const RANK_AT_RENDER = RankSchema.parse({
  tier: "gold",
  division: 2,
  lp: 30,
  wins: 100,
  losses: 90,
});
const RANK_TODAY = RankSchema.parse({
  tier: "platinum",
  division: 4,
  lp: 12,
  wins: 140,
  losses: 110,
});

const stubs = vi.hoisted(() => ({
  send: vi.fn(),
  sendDM: vi.fn(),
  /** Counts what a delivery must never do. */
  generatorRuns: 0,
  matchContextReads: 0,
}));

// Stubbed so the mutation proof can restore the old arm verbatim — the Riot
// read it did is not available here, and its absence would fail the test for
// the wrong reason. The fixed delivery never calls it, which is asserted.
vi.mock("#src/temporal/v2/match-context.ts", () => ({
  resolveScoutV2ObservedMatchContext: (riotMatchId: string) => {
    stubs.matchContextReads += 1;
    return Promise.resolve({
      matchId: riotMatchId,
      riotMatchId,
      matchData: { info: { queueId: 420 } },
      trackedPlayers: [],
    });
  },
}));

vi.mock("#src/report-store/s3-raw-source.ts", async () => {
  const actual = await vi.importActual<typeof S3RawSourceModule>(
    "#src/report-store/s3-raw-source.ts",
  );
  return {
    ArchivedObjectUnusableError: actual.ArchivedObjectUnusableError,
    readVerifiedRawObjectBytes: () =>
      Promise.resolve(new Uint8Array([137, 80, 78, 71, 5, 5])),
  };
});
vi.mock("#src/storage/s3-client.ts", () => ({ createS3Client: () => ({}) }));
vi.mock("#src/discord/utils/channel.ts", () => ({
  fetchChannelForDelivery: () => Promise.resolve({ guildId: undefined }),
}));
vi.mock("#src/discord/client.ts", () => ({ client: {} }));
vi.mock("#src/discord/utils/dm.ts", () => ({ sendDM: stubs.sendDM }));
vi.mock("#src/league/discord/channel.ts", async () => {
  const { channelModuleWithSend } =
    await import("#src/temporal/v2/notification-delivery.test-fixtures.ts");
  return await channelModuleWithSend(stubs.send);
});
vi.mock("#src/league/tasks/postmatch/match-report-generator.ts", () => ({
  // v1's generator stands in for exactly the side effect under test: it
  // refetches the player and writes this match's rank history with the rank
  // they hold NOW. The fixed delivery never reaches it.
  generateMatchReport: async () => {
    const { saveMatchRankHistory } =
      await import("#src/league/model/rank-history.ts");
    stubs.generatorRuns += 1;
    await saveMatchRankHistory({
      matchId: MatchIdSchema.parse(MATCH),
      puuid: PUUID,
      queueType: "solo",
      rankBefore: RANK_AT_RENDER,
      rankAfter: RANK_TODAY,
      matchGameCreationTimestamp: undefined,
      matchGameEndTimestamp: undefined,
    });
  },
}));

// Imported after DATABASE_URL points at this suite's database, so the
// Activity's own client connects to it rather than to the unbound stub.
const { prisma: activityPrisma } = await import("#src/database/index.ts");
const { buildReceipt } = await import("#src/report-lake/durable-receipts.ts");
const { deliverNotificationV2 } =
  await import("#src/temporal/v2/notification-delivery.ts");
const {
  scoutV2NotificationRenderEvidenceCodec,
  scoutV2NotificationRenderReceiptKind,
} = await import("#src/temporal/v2/notification-receipts.ts");

afterAll(async () => {
  await prisma.$disconnect();
  await activityPrisma.$disconnect();
});

const RIOT_MATCH = RiotMatchIdSchema.parse(MATCH);

async function seedRenderedReport(): Promise<void> {
  expect(
    await recordReceipt(
      prisma,
      buildReceipt({
        matchId: RIOT_MATCH,
        kind: scoutV2NotificationRenderReceiptKind("postmatch"),
        recordedAt: new Date("2026-09-18T00:00:00.000Z"),
        evidence: scoutV2NotificationRenderEvidenceCodec.serialize({
          artifact: "report",
          riotMatchId: RIOT_MATCH,
          image: {
            objectKey: S3ObjectKeySchema.parse(
              `games/2026/09/18/${MATCH}/report.png`,
            ),
            digest: Sha256DigestSchema.parse("a".repeat(64)),
            bytes: IMAGE.byteLength,
            contentType: "image/png",
          },
          content: CONTENT,
          components: "match-link",
        }),
      }),
    ),
  ).toEqual({ outcome: "applied" });
}

async function seedIntent(channel: string): Promise<NotificationIntentKey> {
  const key = NotificationIntentKeySchema.parse(
    `postmatch-discord:${MATCH}:${channel}`,
  );
  expect(
    await upsertIntent(prisma, {
      matchId: RIOT_MATCH,
      intent: NotificationIntentSchema.parse({
        key,
        kind: "postmatch",
        origin: { kind: "live" },
        target: { kind: "channel", channelId: testChannelId(channel) },
        freshnessDeadline: "2099-01-01T00:00:00.000Z",
        createdAt: "2026-09-18T00:00:00.000Z",
        attemptCount: 0,
        state: { kind: "ready" },
      }),
    }),
  ).toEqual({ outcome: "applied" });
  return key;
}

/** The rank history the render captured for this match. */
async function seedRankHistory(): Promise<void> {
  const { saveMatchRankHistory } =
    await import("#src/league/model/rank-history.ts");
  await saveMatchRankHistory({
    matchId: MatchIdSchema.parse(MATCH),
    puuid: PUUID,
    queueType: "solo",
    rankBefore: undefined,
    rankAfter: RANK_AT_RENDER,
    matchGameCreationTimestamp: undefined,
    matchGameEndTimestamp: undefined,
    prismaClient: prisma,
  });
}

async function storedRankHistory(): Promise<unknown> {
  return await prisma.matchRankHistory.findMany({
    where: { matchId: MatchIdSchema.parse(MATCH) },
    select: { puuid: true, queueType: true, rankBefore: true, rankAfter: true },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  stubs.generatorRuns = 0;
  stubs.matchContextReads = 0;
  stubs.send.mockResolvedValue({ id: "100000000000000777" });
});

describe("a post-match delivery's effect on domain facts", () => {
  test("leaves the rank captured at render untouched, however late it is driven", async () => {
    await seedRenderedReport();
    await seedRankHistory();
    const key = await seedIntent("9501");
    const before = await storedRankHistory();

    // The player has since played again; this is the reconciliation sweep
    // that drives the intent days later.
    const result = await deliverNotificationV2({
      stage: "dev",
      intentKey: key,
      attemptNonce: NotificationAttemptNonceSchema.parse("attempt-nonce-1"),
    });

    expect(result).toMatchObject({ outcome: "delivered" });
    expect(await storedRankHistory()).toEqual(before);
    expect(JSON.stringify(before)).toContain(String(RANK_AT_RENDER.lp));
    expect(stubs.generatorRuns).toBe(0);
    expect(stubs.matchContextReads).toBe(0);
  });

  test("delivers the attested report to a second channel without touching the generator", async () => {
    const key = await seedIntent("9502");

    const result = await deliverNotificationV2({
      stage: "dev",
      intentKey: key,
      attemptNonce: NotificationAttemptNonceSchema.parse("attempt-nonce-2"),
    });

    expect(result).toMatchObject({ outcome: "delivered" });
    expect(stubs.generatorRuns).toBe(0);
    expect(stubs.send).toHaveBeenCalledTimes(1);
  });
});
