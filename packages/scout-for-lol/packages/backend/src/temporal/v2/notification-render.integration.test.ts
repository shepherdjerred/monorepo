import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { MatchIdSchema } from "@scout-for-lol/data";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import {
  IsoInstantSchema,
  NotificationIntentKeySchema,
  RiotMatchIdSchema,
  S3ObjectKeySchema,
  type NotificationIntentKey,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  NotificationIntentSchema,
  type NotificationIntentKind,
} from "@scout-for-lol/domain/notifications/intent.ts";
import type { StoredObject } from "#src/storage/object-integrity.ts";
import { computeSha256Digest } from "#src/storage/object-integrity.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testChannelId } from "#src/testing/test-ids.ts";
import {
  upsertIntent,
  upsertSubjectIntent,
} from "#src/database/durable/intent-repository.ts";
import { listReceipts } from "#src/database/durable/receipt-repository.ts";
import { duelStatusAnnouncementCodec } from "#src/progression/duels/status-message.ts";
import { dareStatusAnnouncementCodec } from "#src/betting/dares/presentation/notify/dare-status-message.ts";

/**
 * The render Activity against real receipts and claims, with the world it
 * renders from and the store it commits to stubbed.
 *
 * Two properties are pinned. Receipts are keyed by KIND: a prematch receipt
 * standing on a match never satisfies a postmatch render, and vice versa.
 * And publication is serialized per (match, kind): however many per-channel
 * children ask for one match's artifact at once, one render runs, one PUT
 * lands, the single receipt attests the bytes that are in the store, and
 * every other caller reports `reused`.
 *
 * Mutation proof for the second: run `apply` outside `runGuardedEffectV2` and
 * both children render — two PUTs land on one key, the second attest
 * conflicts, and the receipt describes bytes the store no longer holds.
 */
const testDatabase = createTestDatabase("temporal-v2-notification-render");
Bun.env["DATABASE_URL"] = testDatabase.dbUrl;
const { prisma } = testDatabase;
vi.mock("#src/discord/utils/channel.ts", () => ({
  fetchChannelForDelivery: (channelId: string) =>
    Promise.resolve(
      world.guilds.has(channelId)
        ? { guildId: world.guilds.get(channelId) }
        : null,
    ),
}));
vi.mock("#src/league/clash/access.ts", () => ({
  clashSurfaceEnabledForGuild: (guildId: string) =>
    Promise.resolve(world.clashGuilds.has(guildId)),
}));

/** Everything a render touches outside the database, as one in-memory world. */
const world = vi.hoisted(() => ({
  /** The store, keyed by object key; last write wins, as S3 does. */
  objects: new Map<string, Uint8Array>(),
  puts: new Array<string>(),
  renders: 0,
  guilds: new Map<string, string>(),
  clashGuilds: new Set<string>(),
  renderedClash: new Array<boolean | undefined>(),
  renderDelayMs: 0,
  /** Each render produces different bytes, so a second PUT is observable. */
  nextImage: (): Uint8Array => new Uint8Array([137, 80, 78, 71, world.renders]),
}));

vi.mock("#src/temporal/v2/match-context.ts", () => ({
  resolveScoutV2ObservedMatchContext: (riotMatchId: string) =>
    Promise.resolve({
      matchId: riotMatchId,
      riotMatchId,
      matchData: {
        metadata: { matchId: riotMatchId },
        info: { queueId: 420, gameMode: "CLASSIC", gameType: "MATCHED_GAME" },
      },
      trackedPlayers: [],
    }),
}));
vi.mock("#src/league/tasks/postmatch/match-report-generator.ts", () => ({
  generateMatchReport: async (matchData: { metadata: { matchId: string } }) => {
    // Built with v1's own furniture, so the render's disassembly is exercised
    // against the message shape it must survive rather than one written here.
    const { attachReportImage } =
      await import("#src/league/tasks/postmatch/match-report-image.ts");
    world.renders += 1;
    const image = world.nextImage();
    await new Promise((done) => setTimeout(done, world.renderDelayMs));
    const [attachment, embed] = attachReportImage(
      image,
      MatchIdSchema.parse(matchData.metadata.matchId),
    );
    return {
      content: "someone finished a game",
      files: [attachment],
      embeds: [embed],
    };
  },
}));
vi.mock("#src/temporal/v2/notification/prematch-notification.ts", () => ({
  renderPrematchNotificationV2: (_matchId: string, clashEnabled?: boolean) => {
    world.renders += 1;
    world.renderedClash.push(clashEnabled);
    return Promise.resolve({ artifact: "image", image: world.nextImage() });
  },
}));
vi.mock("#src/storage/s3-helpers.ts", () => ({
  saveToS3: (config: {
    matchId: string;
    assetType: string;
    body: Uint8Array;
  }) => {
    const key = S3ObjectKeySchema.parse(
      `games/2026/09/18/${config.matchId}/${config.assetType}.png`,
    );
    world.objects.set(key, config.body);
    world.puts.push(key);
    const stored: StoredObject = {
      key,
      digest: computeSha256Digest(config.body),
      bytes: config.body.byteLength,
      contentType: "image/png",
      capturedAt: IsoInstantSchema.parse("2026-09-18T00:00:00.000Z"),
      url: `s3://test/${key}`,
    };
    return Promise.resolve(stored);
  },
}));

const { prisma: activityPrisma } = await import("#src/database/index.ts");
const { renderNotificationArtifactV2 } =
  await import("#src/temporal/v2/notification-render.ts");
const { readNotificationArtifactV2 } =
  await import("#src/temporal/v2/notification-receipts.ts");

afterAll(async () => {
  await prisma.$disconnect();
  await activityPrisma.$disconnect();
});

const STAGE = "dev" as const;
let matchSequence = 9400;

async function seedIntent(
  matchId: string,
  kind: NotificationIntentKind,
  channel: string,
): Promise<NotificationIntentKey> {
  const key = NotificationIntentKeySchema.parse(
    `${kind}-discord:${matchId}:${channel}`,
  );
  expect(
    await upsertIntent(prisma, {
      matchId: RiotMatchIdSchema.parse(matchId),
      intent: NotificationIntentSchema.parse({
        key,
        kind,
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

function nextMatch(): string {
  matchSequence += 1;
  return `NA1_${matchSequence.toString()}`;
}

beforeEach(async () => {
  await prisma.matchProcessingReceipt.deleteMany();
  await prisma.scoutEffectClaim.deleteMany();
  await prisma.notificationPresentation.deleteMany();
  world.objects.clear();
  world.puts.length = 0;
  world.renders = 0;
  world.renderDelayMs = 0;
  world.guilds.clear();
  world.clashGuilds.clear();
  world.renderedClash.length = 0;
});

async function expectStatusWithoutMatchRender(
  intentKey: NotificationIntentKey,
): Promise<void> {
  expect(
    await renderNotificationArtifactV2({ stage: STAGE, intentKey }),
  ).toEqual({ outcome: "rendered" });
  expect(world.renders).toBe(0);
  expect(world.puts).toHaveLength(0);
  expect(await prisma.matchProcessingReceipt.count()).toBe(0);
}

describe("render receipts are keyed by kind", () => {
  test("mixed guilds receive separately attested Clash and ordinary screens with frozen decisions", async () => {
    const matchId = nextMatch();
    const first = await seedIntent(matchId, "prematch", "9451");
    const second = await seedIntent(matchId, "prematch", "9452");
    const firstGuild = DiscordGuildIdSchema.parse("100000000000009451");
    const secondGuild = DiscordGuildIdSchema.parse("100000000000009452");
    world.guilds.set(testChannelId("9451"), firstGuild);
    world.guilds.set(testChannelId("9452"), secondGuild);
    world.clashGuilds.add(firstGuild);
    await renderNotificationArtifactV2({ stage: STAGE, intentKey: first });
    await renderNotificationArtifactV2({ stage: STAGE, intentKey: second });
    expect(world.renderedClash).toEqual([true, false]);
    expect(world.puts).toHaveLength(2);
    expect(new Set(world.puts).size).toBe(2);
    const receipts = await listReceipts(prisma, {
      matchId: RiotMatchIdSchema.parse(matchId),
    });
    expect(receipts.map((receipt) => receipt.receipt.scope)).toEqual(
      expect.arrayContaining([
        { kind: "guild", guildId: firstGuild },
        { kind: "guild", guildId: secondGuild },
      ]),
    );
    world.clashGuilds.clear();
    expect(
      await renderNotificationArtifactV2({ stage: STAGE, intentKey: first }),
    ).toEqual({ outcome: "reused" });
    expect(world.renderedClash).toEqual([true, false]);
  });
  test("a Dare status has no match render receipt or object", async () => {
    const intentKey = NotificationIntentKeySchema.parse(
      "dare-status:test:recipient:200000000000000902",
    );
    expect(
      await upsertSubjectIntent(prisma, {
        dareId: 902,
        intent: NotificationIntentSchema.parse({
          key: intentKey,
          kind: "dare-status",
          origin: { kind: "live" },
          target: { kind: "dm", accountId: "200000000000000902" },
          freshnessDeadline: "2099-01-01T00:00:00.000Z",
          createdAt: "2026-09-30T00:00:00.000Z",
          attemptCount: 0,
          announcement: dareStatusAnnouncementCodec.serialize({
            dareId: 902,
            revision: 1,
            guildId: DiscordGuildIdSchema.parse("100000000000000902"),
            category: "progress",
            kind: "advanced",
            summary: "One win remains.",
          }),
          state: { kind: "pending" },
        }),
      }),
    ).toEqual({ outcome: "applied" });
    await expectStatusWithoutMatchRender(intentKey);
  });

  test("a Duel status has no match render receipt or object", async () => {
    const duelId = crypto.randomUUID();
    const intentKey = NotificationIntentKeySchema.parse(
      `duel-status:duel-invited:${duelId}`,
    );
    expect(
      await upsertSubjectIntent(prisma, {
        duelId,
        intent: NotificationIntentSchema.parse({
          key: intentKey,
          kind: "duel-status",
          origin: { kind: "live" },
          target: { kind: "channel", channelId: testChannelId("901") },
          freshnessDeadline: "2099-01-01T00:00:00.000Z",
          createdAt: "2026-09-18T00:00:00.000Z",
          attemptCount: 0,
          announcement: duelStatusAnnouncementCodec.serialize({
            guildId: DiscordGuildIdSchema.parse("100000000000000901"),
            payload: {
              kind: "invited",
              seriesId: duelId,
              mentionDiscordIds: [],
            },
          }),
          state: { kind: "pending" },
        }),
      }),
    ).toEqual({ outcome: "applied" });
    await expectStatusWithoutMatchRender(intentKey);
  });
  test("a standing prematch receipt does not satisfy a postmatch render", async () => {
    const matchId = nextMatch();
    const prematch = await seedIntent(matchId, "prematch", "9401");
    const postmatch = await seedIntent(matchId, "postmatch", "9402");

    expect(
      await renderNotificationArtifactV2({ stage: STAGE, intentKey: prematch }),
    ).toEqual({ outcome: "rendered" });
    expect(
      await readNotificationArtifactV2(
        RiotMatchIdSchema.parse(matchId),
        "postmatch",
      ),
    ).toBeNull();

    expect(
      await renderNotificationArtifactV2({
        stage: STAGE,
        intentKey: postmatch,
      }),
    ).toEqual({ outcome: "rendered" });

    expect(world.renders).toBe(2);
    const receipts = await listReceipts(prisma, {
      matchId: RiotMatchIdSchema.parse(matchId),
    });
    expect(receipts.map((record) => record.receipt.kind).sort()).toEqual([
      "v2-notification-render-postmatch",
      "v2-notification-render-prematch",
    ]);
  });

  test("a standing postmatch receipt does not satisfy a prematch render", async () => {
    const matchId = nextMatch();
    const postmatch = await seedIntent(matchId, "postmatch", "9403");
    const prematch = await seedIntent(matchId, "prematch", "9404");

    await renderNotificationArtifactV2({ stage: STAGE, intentKey: postmatch });
    expect(
      await renderNotificationArtifactV2({ stage: STAGE, intentKey: prematch }),
    ).toEqual({ outcome: "rendered" });
    expect(world.renders).toBe(2);
  });

  test("a second child of the same kind reuses the standing artifact", async () => {
    const matchId = nextMatch();
    const first = await seedIntent(matchId, "postmatch", "9405");
    const second = await seedIntent(matchId, "postmatch", "9406");

    await renderNotificationArtifactV2({ stage: STAGE, intentKey: first });
    expect(
      await renderNotificationArtifactV2({ stage: STAGE, intentKey: second }),
    ).toEqual({ outcome: "reused" });
    expect(world.renders).toBe(1);
  });
});

describe("concurrent renders for one match and kind", () => {
  test("one render, one PUT, one receipt attesting the bytes in the store", async () => {
    // Two per-channel children arrive together and both read "no receipt".
    // The fence makes the second wait; when it acquires, the claim is
    // completed and it reuses without rendering. Without the fence both
    // render, both PUT the same key, and the receipt describes the loser's
    // overwritten bytes.
    const matchId = nextMatch();
    const a = await seedIntent(matchId, "postmatch", "9407");
    const b = await seedIntent(matchId, "postmatch", "9408");
    world.renderDelayMs = 300;

    const [first, second] = await Promise.all([
      renderNotificationArtifactV2({ stage: STAGE, intentKey: a }),
      renderNotificationArtifactV2({ stage: STAGE, intentKey: b }),
    ]);

    expect(world.puts).toHaveLength(1);
    expect(world.renders).toBe(1);
    expect([first, second].map((result) => result.outcome).sort()).toEqual([
      "rendered",
      "reused",
    ]);
    const evidence = await readNotificationArtifactV2(
      RiotMatchIdSchema.parse(matchId),
      "postmatch",
    );
    if (evidence?.artifact !== "report") {
      throw new Error("the render must have attested a report");
    }
    const stored = world.objects.get(evidence.image.objectKey);
    expect(stored).toBeDefined();
    expect(computeSha256Digest(stored ?? new Uint8Array())).toBe(
      evidence.image.digest,
    );
    const receipts = await listReceipts(prisma, {
      matchId: RiotMatchIdSchema.parse(matchId),
    });
    expect(receipts).toHaveLength(1);
  }, 30_000);
});
