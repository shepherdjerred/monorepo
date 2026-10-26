import type * as DatabaseModule from "#src/database/index.ts";
import {
  deliveryIntentKey,
  prematchDeliveryKeyPrefix,
} from "#src/durable/match/delivery-intents.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testGuildId } from "#src/testing/test-ids.ts";
import {
  IsoInstantSchema,
  NotificationIntentKeySchema,
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { DiscordChannelIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import { PlatformRouteSchema } from "@scout-for-lol/domain/identity/routes.ts";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * What a post-match match mints, against real rows.
 *
 * The question these cover is not "does an intent get written" — the prematch
 * lane already proves the write discipline — but WHICH matches may write one
 * at all. A `silent-backfill` match must leave no evidence that a delivery was
 * intended: no intent row, in any state, for any kind.
 */

const { prisma } = createTestDatabase("scout-v2-match-intents");

const MATCH = RiotMatchIdSchema.parse("NA1_8300");
const SILENT_MATCH = RiotMatchIdSchema.parse("NA1_8301");
const CHANNEL = "100000000000000021";
const GUILD = testGuildId("4200");

vi.mock("#src/database/index.ts", async () => {
  const actual = await vi.importActual<typeof DatabaseModule>(
    "#src/database/index.ts",
  );
  return { ...actual, prisma };
});

// The audience is v1's own resolver; the channels it returns are not what
// these tests are about, so it answers one subscribed channel for every match.
vi.mock("#src/league/tasks/notification-filters.ts", () => ({
  resolvePostmatchDeliveryChannels: () =>
    Promise.resolve({
      subscribed: [],
      deliverable: [{ channel: CHANNEL, serverId: GUILD, subscriptions: [] }],
      guildIds: [GUILD],
    }),
}));

const { mintPostmatchIntents } =
  await import("#src/temporal/notification/match-intents.ts");
const { observeMatch, getObservation } =
  await import("#src/database/durable/observation-repository.ts");
const { listIntentsForMatch, upsertIntent } =
  await import("#src/database/durable/intent-repository.ts");
const { planMatchFanOut } = await import("#src/temporal/match/match-reads.ts");

const GAME_CREATED_AT = Date.parse("2026-09-19T09:00:00.000Z");

async function observe(
  matchId: RiotMatchId,
  deliveryMode: "live" | "silent-backfill",
): Promise<void> {
  await observeMatch(prisma, {
    matchId: matchId,
    platformRoute: PlatformRouteSchema.parse("NA1"),
    policy: "FULL",
    deliveryMode,
    matchDataSource: "RIOT",
    owner: { kind: "temporal-v2" },
    promotion: null,
    gameCreatedAt: IsoInstantSchema.parse("2026-09-19T09:00:00.000Z"),
    observedAt: IsoInstantSchema.parse("2026-09-19T09:30:00.000Z"),
    artifacts: { match: null, timeline: null },
  });
}

function mint(matchId: RiotMatchId) {
  return mintPostmatchIntents(prisma, {
    matchId: matchId,
    puuids: [],
    queue: { queueId: 420, gameMode: "CLASSIC", gameType: "MATCHED_GAME" },
    gameCreation: GAME_CREATED_AT,
    createdAt: new Date("2026-09-19T09:35:00.000Z"),
  });
}

beforeEach(async () => {
  await prisma.matchNotificationIntent.deleteMany();
  await prisma.matchObservation.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("what a post-match match mints", () => {
  test("mints the report for a live match", async () => {
    await observe(MATCH, "live");

    expect(await mint(MATCH)).toEqual({
      minted: 1,
      existing: 0,
      conflicts: 0,
      silent: 0,
      undeliverable: 0,
    });
    const intents = await listIntentsForMatch(prisma, { matchId: MATCH });
    expect(intents).toHaveLength(1);
    expect(intents[0]?.intent.kind).toBe("postmatch");
    expect(intents[0]?.intent.origin).toEqual({ kind: "live" });
    expect(intents[0]?.intent.state).toEqual({ kind: "pending" });
  });

  test("mints NOTHING for a silent-backfill match", async () => {
    // The whole point of the mode. Not a suppressed row, not a row nobody
    // drives — no row at all, because the row is the evidence that a delivery
    // was intended and the backlog gauge and the sweep both read it.
    await observe(SILENT_MATCH, "silent-backfill");

    expect(await mint(SILENT_MATCH)).toEqual({
      minted: 0,
      existing: 0,
      conflicts: 0,
      silent: 1,
      undeliverable: 0,
    });
    expect(
      await listIntentsForMatch(prisma, { matchId: SILENT_MATCH }),
    ).toEqual([]);
  });

  test("is read-gated, so a retry mints nothing new", async () => {
    await observe(MATCH, "live");
    await mint(MATCH);

    expect(await mint(MATCH)).toMatchObject({ minted: 0, existing: 1 });
    expect(await listIntentsForMatch(prisma, { matchId: MATCH })).toHaveLength(
      1,
    );
  });

  test("refuses to mint for a match nothing has observed", async () => {
    // Every minting site runs after the observation commit, so no observation
    // is a broken caller contract. Defaulting either way is unrecoverable:
    // one announces a backfill, the other silences a live match.
    await expect(mint(MATCH)).rejects.toThrow(
      /owed a public delivery is unknown/,
    );
    expect(await listIntentsForMatch(prisma, { matchId: MATCH })).toEqual([]);
  });

  test("reads the mode from the row, not from the caller", async () => {
    // A caller cannot talk this into minting: there is no parameter to pass.
    // Flipping the committed row is the only thing that changes the answer,
    // and the observation claim is what defends that row against drift.
    await observe(SILENT_MATCH, "silent-backfill");
    expect(await mint(SILENT_MATCH)).toMatchObject({ silent: 1, minted: 0 });

    const stored = await getObservation(prisma, { matchId: SILENT_MATCH });
    expect(stored?.deliveryMode).toBe("silent-backfill");
  });
});

describe("what the post-match fan-out drives", () => {
  test("never drives a prematch intent, however fresh it still is", async () => {
    // The hazard is this Activity's TIMING, not its routing. A prematch intent
    // announces a game STARTING and this runs when the game is known to have
    // ended — but the freshness deadline is the game's own three-hour TTL, so
    // a match discovered minutes after it finished is still well inside it.
    // A prematch row an outage left `pending` would therefore pass `beginSend`
    // and post "game starting" after the result was already known.
    await observe(MATCH, "live");
    const prematchKey = NotificationIntentKeySchema.parse(
      deliveryIntentKey(
        prematchDeliveryKeyPrefix(MATCH),
        DiscordChannelIdSchema.parse(CHANNEL),
      ),
    );
    await upsertIntent(prisma, {
      matchId: MATCH,
      intent: {
        key: prematchKey,
        kind: "prematch",
        origin: { kind: "live" },
        target: {
          kind: "channel",
          channelId: DiscordChannelIdSchema.parse(CHANNEL),
        },
        // Deliberately far in the future: the deadline is not what saves us.
        freshnessDeadline: IsoInstantSchema.parse("2099-01-01T00:00:00.000Z"),
        createdAt: IsoInstantSchema.parse("2026-09-19T09:05:00.000Z"),
        attemptCount: 0,
        state: { kind: "pending" },
      },
    });
    await mint(MATCH);

    const plan = await planMatchFanOut({ riotMatchId: MATCH });

    expect(plan.notificationIntentKeys).not.toContain(prematchKey);
    // The report for the same match and channel is still driven, so this is
    // an exclusion of the KIND and not of the match or the channel.
    expect(plan.notificationIntentKeys).toHaveLength(1);
  });
});
