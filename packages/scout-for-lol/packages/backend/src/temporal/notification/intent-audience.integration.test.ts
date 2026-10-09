import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  RiotMatchIdSchema,
  type NotificationIntentKey,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  NotificationIntentSchema,
  NotificationAttemptNonceSchema,
  type NotificationAttemptNonce,
} from "@scout-for-lol/domain/notifications/intent.ts";
import type { ScoutIntentAttemptRef } from "@scout-for-lol/temporal/pipeline-contracts";
import type * as InstalledGuildsModule from "#src/lib/discord/installed-guilds.ts";
import type * as ChannelModule from "#src/league/discord/channel.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  testChannelId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";

/**
 * The send path's half of retirement: `beginNotificationSend` asking whether
 * the audience still exists before it mints an attempt, against real rows.
 *
 * Discord is the one thing stubbed, at the two reads the audience check makes
 * and at the send itself; every transition runs through the production client
 * pointed at this suite's database.
 *
 * Mutation proofs, one per guard:
 *
 * - Delete the `pending`/`ready` early return in `retireIfAudienceGone`:
 *   "an in-flight send is never retired" fails, because a replayed begin
 *   would ask Discord (the read counter) and conflict instead of answering
 *   `already-applied`.
 * - Drop the `channel.answer === null` arm: "a deleted channel retires"
 *   begins a send.
 * - Invert the `installed` check: "a guild Scout left retires" begins a send
 *   and "a live audience still delivers" retires.
 * - Make `askDiscord` rethrow `DiscordUpstreamError`: "an unreachable Discord
 *   is no evidence" fails the begin.
 * - Return `result` unconditionally from `retireIfAudienceGone`: "a
 *   retirement that loses to another writer" reports `send-in-flight`
 *   instead of begin's own `already-sending`.
 */
const testDatabase = createTestDatabase("temporal-v2-intent-audience");
Bun.env["DATABASE_URL"] = testDatabase.dbUrl;
const { prisma } = testDatabase;

const stubs = vi.hoisted(() => ({
  readChannel: vi.fn(),
  freshGuildMember: vi.fn(),
  isInstalled: vi.fn(),
  fetchChannelForDelivery: vi.fn(),
  isPolicyEnabled: vi.fn(),
  send: vi.fn(),
}));

vi.mock("#src/configuration/flags.ts", async () => ({
  ...(await vi.importActual<Record<string, unknown>>(
    "#src/configuration/flags.ts",
  )),
  isPolicyEnabled: stubs.isPolicyEnabled,
}));

vi.mock("#src/lib/discord/bot-rest.ts", () => ({
  botRest: () => ({ channel: stubs.readChannel }),
  freshBotMember: stubs.freshGuildMember,
}));
vi.mock("#src/lib/discord/installed-guilds.ts", async () => {
  const actual = await vi.importActual<typeof InstalledGuildsModule>(
    "#src/lib/discord/installed-guilds.ts",
  );
  return { ...actual, isScoutInstalledInGuild: stubs.isInstalled };
});
// What the send delivers is the delivery suites' subject, not this one's: the
// message is a fixed one, and the send is a stub that records it was reached.
vi.mock("#src/temporal/notification/notification-message.ts", () => ({
  buildAttestedMessage: () =>
    Promise.resolve({ content: "a live audience hears about its game" }),
}));
vi.mock("#src/discord/utils/channel.ts", () => ({
  fetchChannelForDelivery: stubs.fetchChannelForDelivery,
}));
vi.mock("#src/discord/client.ts", () => ({ client: {} }));
vi.mock("#src/league/discord/channel.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof ChannelModule>()),
  send: stubs.send,
}));

// Everything that can reach the production client is imported only after
// DATABASE_URL points at this suite's database.
const { prisma: activityPrisma } = await import("#src/database/index.ts");
const { getIntent, upsertIntent } =
  await import("#src/database/durable/intent-repository.ts");
const { oldestReadyNotificationIntentAt } =
  await import("#src/database/durable/pipeline-gaps.ts");
const {
  retiredCount: retiredCountBySource,
  seedChannelIntent,
  seedSubscription,
  seedTrackedAccount,
} = await import("#src/durable/match/intent-retirement.test-fixtures.ts");
const { DiscordUpstreamError } = await import("#src/lib/discord-rest.ts");
const { beginNotificationSend, recordNotificationOutcome } =
  await import("#src/temporal/notification-lane/notification-transitions.ts");
const { deliverNotification } =
  await import("#src/temporal/notification-lane/notification-delivery.ts");
const { scoutDurableNotificationIntentsRetired } =
  await import("#src/metrics/durable-pipeline.ts");
const { audienceRetirementOf, defaultAudienceDiscordPort } =
  await import("#src/temporal/notification/intent-audience.ts");
const { hallRecordBreakIntentKey } =
  await import("#src/durable/match/delivery-intents.ts");
const { hallRecordBreakAnnouncementEnvelope } =
  await import("#src/temporal/notification/announcement-codecs.ts");
const { hallBreakRecords } =
  await import("#src/temporal/notification/hall-record-break.test-fixtures.ts");

afterAll(async () => {
  await prisma.$disconnect();
  await activityPrisma.$disconnect();
});

const MATCH = RiotMatchIdSchema.parse("NA1_9400");
const CHANNEL = testChannelId("9400");
const GUILD = testGuildId("9400");
const PUUID = testPuuid("9400");
const NONCE_A = NotificationAttemptNonceSchema.parse("audience-attempt-a");
const NONCE_B = NotificationAttemptNonceSchema.parse("audience-attempt-b");

function attempt(
  intentKey: NotificationIntentKey,
  attemptNonce: NotificationAttemptNonce,
): ScoutIntentAttemptRef {
  return { stage: "dev", intentKey, attemptNonce };
}

/** Discord's answer for a live channel in a guild Scout is installed in. */
function liveChannel(): unknown {
  return { id: CHANNEL, name: "reports", type: 0, guild_id: GUILD };
}

async function seedLiveAudience(): Promise<number> {
  const { subscriptionId } = await seedSubscription(prisma, {
    channelId: CHANNEL,
    puuid: PUUID,
    alias: "audience",
  });
  await seedTrackedAccount(prisma, {
    matchId: MATCH,
    puuid: PUUID,
  });
  return subscriptionId;
}

async function readyIntent(name: string): Promise<NotificationIntentKey> {
  return await seedChannelIntent(prisma, {
    name,
    matchId: MATCH,
    channelId: CHANNEL,
    state: "ready",
  });
}

async function stored(key: NotificationIntentKey) {
  const record = await getIntent(prisma, { intentKey: key });
  if (record === null) throw new Error(`intent ${key} vanished`);
  return record.intent;
}

async function retiredCount(reason: string): Promise<number> {
  return await retiredCountBySource(reason, "send");
}

beforeEach(async () => {
  vi.clearAllMocks();
  await prisma.matchNotificationIntent.deleteMany();
  await prisma.matchTrackedAccount.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.account.deleteMany();
  await prisma.player.deleteMany();
  await prisma.guildInstall.deleteMany();
  scoutDurableNotificationIntentsRetired.reset();
  stubs.readChannel.mockResolvedValue(liveChannel());
  stubs.freshGuildMember.mockResolvedValue({
    joined_at: "2026-09-01T00:00:00.000Z",
  });
  stubs.isInstalled.mockResolvedValue(true);
  stubs.fetchChannelForDelivery.mockResolvedValue({ guildId: GUILD });
  stubs.isPolicyEnabled.mockResolvedValue(true);
  stubs.send.mockResolvedValue({ id: "100000000000000888" });
});

async function seedHallInstallation(installedAt: string, removedAt?: string) {
  await prisma.guildInstall.create({
    data: {
      serverId: GUILD,
      serverName: "Hall guild",
      ownerDiscordId: "100000000000000001",
      addedByDiscordId: "100000000000000001",
      memberCount: 10,
      installedAt: new Date(installedAt),
      removedAt: removedAt === undefined ? null : new Date(removedAt),
    },
  });
}

describe("Hall audience across guild installations", () => {
  const matchId = RiotMatchIdSchema.parse("NA1_9301");
  const mintedAt = "2026-09-12T10:00:00.000Z";

  function hallRecord() {
    return {
      matchId,
      intent: NotificationIntentSchema.parse({
        key: hallRecordBreakIntentKey(matchId, GUILD),
        kind: "hall-record-break",
        origin: { kind: "live" },
        target: { kind: "channel", channelId: CHANNEL },
        freshnessDeadline: "2099-01-01T00:00:00.000Z",
        createdAt: mintedAt,
        attemptCount: 0,
        announcement: hallRecordBreakAnnouncementEnvelope({
          guildId: GUILD,
          riotMatchId: matchId,
          records: hallBreakRecords(1),
        }),
        state: { kind: "ready" },
      }),
    };
  }

  async function begunHallAttempt(): Promise<ScoutIntentAttemptRef> {
    await seedHallInstallation("2026-09-01T00:00:00.000Z");
    const record = hallRecord();
    expect(await upsertIntent(prisma, record)).toEqual({ outcome: "applied" });
    const ref = attempt(record.intent.key, NONCE_A);
    const begun = await beginNotificationSend(ref);
    expect(begun.state).toMatchObject({
      kind: "sending",
    });
    return ref;
  }

  test("retires a Hall intent while its installation is removed", async () => {
    await seedHallInstallation(
      "2026-09-01T00:00:00.000Z",
      "2026-09-13T00:00:00.000Z",
    );

    expect(
      await audienceRetirementOf(
        prisma,
        hallRecord(),
        defaultAudienceDiscordPort(),
      ),
    ).toBe("guild-left");
    expect(stubs.readChannel).not.toHaveBeenCalled();
  });

  test("retires the old Hall intent after the guild is reinstalled", async () => {
    await seedHallInstallation("2026-09-14T00:00:00.000Z");

    expect(
      await audienceRetirementOf(
        prisma,
        hallRecord(),
        defaultAudienceDiscordPort(),
      ),
    ).toBe("guild-left");
    expect(stubs.readChannel).not.toHaveBeenCalled();
  });

  test("checks Discord when a stale removal predates a new Hall intent", async () => {
    await seedHallInstallation(
      "2026-09-01T00:00:00.000Z",
      "2026-09-10T00:00:00.000Z",
    );

    expect(
      await audienceRetirementOf(
        prisma,
        hallRecord(),
        defaultAudienceDiscordPort(),
      ),
    ).toBeUndefined();
    expect(stubs.isInstalled).toHaveBeenCalledWith(GUILD);
  });

  test("keeps a Hall intent from the current installation", async () => {
    await seedHallInstallation("2026-09-01T00:00:00.000Z");

    expect(
      await audienceRetirementOf(
        prisma,
        hallRecord(),
        defaultAudienceDiscordPort(),
      ),
    ).toBeUndefined();
    expect(stubs.isInstalled).toHaveBeenCalledWith(GUILD);
  });

  test("suppresses an old Hall attempt when the guild is reinstalled after beginSend", async () => {
    const ref = await begunHallAttempt();

    await prisma.guildInstall.update({
      where: { serverId: GUILD },
      data: { installedAt: new Date("2026-09-14T00:00:00.000Z") },
    });

    const delivery = await deliverNotification(ref);
    expect(delivery).toEqual({ outcome: "suppressed", reason: "guild-left" });
    expect(stubs.send).not.toHaveBeenCalled();
    const recorded = await recordNotificationOutcome({ ...ref, delivery });
    expect(recorded.state).toEqual({
      kind: "suppressed",
      reason: "guild-left",
    });
  });

  test("suppresses an old Hall attempt when Discord sees a reinstall that GuildInstall missed", async () => {
    const ref = await begunHallAttempt();

    // The gateway's best-effort reinstall write never landed. Discord's fresh
    // bot membership carries the new generation independently of that row.
    stubs.freshGuildMember.mockResolvedValue({
      joined_at: "2026-09-14T00:00:00.000Z",
    });
    const delivery = await deliverNotification(ref);
    expect(delivery).toEqual({ outcome: "suppressed", reason: "guild-left" });
    expect(stubs.freshGuildMember).toHaveBeenCalledTimes(1);
    expect(stubs.send).not.toHaveBeenCalled();
    const recorded = await recordNotificationOutcome({ ...ref, delivery });
    expect(recorded.state).toEqual({
      kind: "suppressed",
      reason: "guild-left",
    });
  });

  test("retries a Hall attempt when Discord cannot confirm its join time", async () => {
    const ref = await begunHallAttempt();

    stubs.freshGuildMember.mockResolvedValue({ joined_at: null });
    const delivery = await deliverNotification(ref);
    expect(delivery).toEqual({
      outcome: "failed",
      failure: { classification: "retryable", reason: "service-unavailable" },
    });
    expect(stubs.send).not.toHaveBeenCalled();
    const recorded = await recordNotificationOutcome({ ...ref, delivery });
    expect(recorded.state).toEqual({ kind: "ready" });
  });

  test("delivers a Hall attempt from the current Discord membership", async () => {
    const ref = await begunHallAttempt();

    const delivery = await deliverNotification(ref);
    expect(delivery).toEqual({
      outcome: "delivered",
      messageId: "100000000000000888",
    });
    expect(stubs.freshGuildMember).toHaveBeenCalledTimes(1);
    expect(stubs.send).toHaveBeenCalledTimes(1);
  });
});

describe("beginNotificationSend and a deleted audience", () => {
  test("a deleted subscription retires instead of beginning a send", async () => {
    const subscriptionId = await seedLiveAudience();
    const key = await readyIntent("deleted-subscription");
    await prisma.subscription.delete({ where: { id: subscriptionId } });

    const begun = await beginNotificationSend(attempt(key, NONCE_A));

    const retired = { kind: "suppressed", reason: "subscription-deleted" };
    expect(begun).toEqual({
      commit: { outcome: "applied" },
      state: retired,
      attemptCount: 0,
    });
    const intent = await stored(key);
    expect(intent.state).toEqual(retired);
    expect(intent.attemptCount).toBe(0);
    expect(await oldestReadyNotificationIntentAt(prisma)).toBeNull();
    expect(await retiredCount("subscription-deleted")).toBe(1);
    expect(stubs.send).not.toHaveBeenCalled();

    // A replay of the same begin answers from the row and counts nothing.
    expect(await beginNotificationSend(attempt(key, NONCE_A))).toMatchObject({
      commit: { outcome: "conflict", reason: "terminal-state" },
      state: retired,
    });
    expect(await retiredCount("subscription-deleted")).toBe(1);
  });

  test("a live audience still delivers", async () => {
    await seedLiveAudience();
    const key = await readyIntent("live");

    const begun = await beginNotificationSend(attempt(key, NONCE_A));
    expect(begun.commit).toEqual({ outcome: "applied" });
    expect(begun.state).toMatchObject({
      kind: "sending",
      attemptNonce: NONCE_A,
    });
    expect(stubs.isInstalled).toHaveBeenCalledWith(GUILD);

    const delivery = await deliverNotification(attempt(key, NONCE_A));
    expect(delivery).toEqual({
      outcome: "delivered",
      messageId: "100000000000000888",
    });
    const recorded = await recordNotificationOutcome({
      ...attempt(key, NONCE_A),
      delivery,
    });
    expect(recorded.state).toMatchObject({
      kind: "delivered",
      messageId: "100000000000000888",
    });
    expect(stubs.send).toHaveBeenCalledTimes(1);
    expect(await retiredCount("subscription-deleted")).toBe(0);
  });

  test("a deleted channel retires even while its subscriptions stand", async () => {
    await seedLiveAudience();
    const key = await readyIntent("deleted-channel");
    stubs.readChannel.mockResolvedValue(null);

    const begun = await beginNotificationSend(attempt(key, NONCE_A));

    expect(begun.state).toEqual({
      kind: "suppressed",
      reason: "channel-deleted",
    });
    expect(await retiredCount("channel-deleted")).toBe(1);
  });

  test("a guild Scout left retires", async () => {
    await seedLiveAudience();
    const key = await readyIntent("guild-left");
    stubs.isInstalled.mockResolvedValue(false);

    const begun = await beginNotificationSend(attempt(key, NONCE_A));

    expect(begun.state).toEqual({ kind: "suppressed", reason: "guild-left" });
    expect(await retiredCount("guild-left")).toBe(1);
  });

  test("a settlement whose channel was deleted retires", async () => {
    const key = await seedChannelIntent(prisma, {
      name: "settlement",
      kind: "settlement",
      matchId: MATCH,
      channelId: CHANNEL,
      state: "ready",
    });
    stubs.readChannel.mockResolvedValue(null);

    const begun = await beginNotificationSend(attempt(key, NONCE_A));

    expect(begun.state).toEqual({
      kind: "suppressed",
      reason: "channel-deleted",
    });
  });

  test("a settlement is never judged by subscriptions", async () => {
    // No subscription anywhere: a settlement's audience is the channel its
    // pool was posted in, which Discord says still exists.
    const key = await seedChannelIntent(prisma, {
      name: "settlement-live",
      kind: "settlement",
      matchId: MATCH,
      channelId: CHANNEL,
      state: "ready",
    });

    const begun = await beginNotificationSend(attempt(key, NONCE_A));

    expect(begun.state).toMatchObject({ kind: "sending" });
  });

  test("an unreachable Discord is no evidence", async () => {
    await seedLiveAudience();
    const key = await readyIntent("unreachable");
    stubs.readChannel.mockRejectedValue(
      new DiscordUpstreamError("http_error", "Missing Access", 403),
    );

    const begun = await beginNotificationSend(attempt(key, NONCE_A));

    expect(begun.state).toMatchObject({ kind: "sending" });
    expect(stubs.isInstalled).not.toHaveBeenCalled();
  });

  test("an in-flight send is never retired", async () => {
    const subscriptionId = await seedLiveAudience();
    const key = await readyIntent("in-flight");
    const begun = await beginNotificationSend(attempt(key, NONCE_A));
    expect(begun.state).toMatchObject({ kind: "sending" });
    const before = await stored(key);
    vi.clearAllMocks();

    // The whole audience goes while the attempt is in flight.
    await prisma.subscription.delete({ where: { id: subscriptionId } });
    stubs.readChannel.mockResolvedValue(null);

    expect(await beginNotificationSend(attempt(key, NONCE_A))).toEqual({
      commit: { outcome: "already-applied" },
      state: before.state,
      attemptCount: 1,
    });
    expect(await beginNotificationSend(attempt(key, NONCE_B))).toEqual({
      commit: { outcome: "conflict", reason: "already-sending" },
      state: before.state,
      attemptCount: 1,
    });
    expect(await stored(key)).toEqual(before);
    expect(stubs.readChannel).not.toHaveBeenCalled();
    expect(await retiredCount("channel-deleted")).toBe(0);
  });

  test("unknown-delivery is never retired", async () => {
    const subscriptionId = await seedLiveAudience();
    const key = await readyIntent("unknown");
    await beginNotificationSend(attempt(key, NONCE_A));
    await recordNotificationOutcome({
      ...attempt(key, NONCE_A),
      delivery: { outcome: "unknown" },
    });
    const before = await stored(key);
    await prisma.subscription.delete({ where: { id: subscriptionId } });
    stubs.readChannel.mockResolvedValue(null);

    const refused = await beginNotificationSend(attempt(key, NONCE_B));

    expect(refused.commit).toEqual({
      outcome: "conflict",
      reason: "unknown-delivery-requires-operator",
    });
    expect(await stored(key)).toEqual(before);
  });

  test("a retirement that loses to another writer yields begin's own answer", async () => {
    await seedLiveAudience();
    const key = await readyIntent("lost-race");
    // Between this begin's read and its retirement, another attempt commits:
    // the retirement must lose, and the caller must hear what `beginSend`
    // says about that attempt rather than the retirement's refusal.
    stubs.readChannel.mockImplementation(async () => {
      const { transitionIntent } =
        await import("#src/database/durable/intent-repository.ts");
      const { beginSend } =
        await import("@scout-for-lol/domain/notifications/intent-transitions.ts");
      const { toIsoInstant } =
        await import("#src/durable/match/match-identity.ts");
      const raced = await transitionIntent(prisma, {
        intentKey: key,
        transition: (intent) =>
          beginSend(intent, {
            attemptNonce: NONCE_B,
            startedAt: toIsoInstant(new Date()),
          }),
      });
      expect(raced.outcome).toBe("applied");
      return null;
    });

    const begun = await beginNotificationSend(attempt(key, NONCE_A));

    expect(begun.commit).toEqual({
      outcome: "conflict",
      reason: "already-sending",
    });
    expect(begun.state).toMatchObject({
      kind: "sending",
      attemptNonce: NONCE_B,
    });
    expect(await retiredCount("channel-deleted")).toBe(0);
  });
});
