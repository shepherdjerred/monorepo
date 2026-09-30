import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { NotificationIntentKey } from "@scout-for-lol/domain/identity/brands.ts";
import {
  NotificationAttemptNonceSchema,
  type NotificationAttemptNonce,
} from "@scout-for-lol/domain/notifications/intent.ts";
import type { ScoutIntentAttemptRefV2 } from "@scout-for-lol/temporal/contracts-v2";
import type * as InstalledGuildsModule from "#src/lib/discord/installed-guilds.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  testChannelId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";

/**
 * The send path's half of retirement: `beginNotificationSendV2` asking whether
 * the audience still exists before it mints an attempt, against real rows.
 *
 * Discord is the one thing stubbed, at the two reads the audience check makes
 * and at the send itself; every transition runs through the production client
 * pointed at this suite's database.
 *
 * Mutation proofs, one per guard:
 *
 * - Delete the `pending`/`ready` early return in `retireIfAudienceGoneV2`:
 *   "an in-flight send is never retired" fails, because a replayed begin
 *   would ask Discord (the read counter) and conflict instead of answering
 *   `already-applied`.
 * - Drop the `channel.answer === null` arm: "a deleted channel retires"
 *   begins a send.
 * - Invert the `installed` check: "a guild Scout left retires" begins a send
 *   and "a live audience still delivers" retires.
 * - Make `askDiscord` rethrow `DiscordUpstreamError`: "an unreachable Discord
 *   is no evidence" fails the begin.
 * - Return `result` unconditionally from `retireIfAudienceGoneV2`: "a
 *   retirement that loses to another writer" reports `send-in-flight`
 *   instead of begin's own `already-sending`.
 */
const testDatabase = createTestDatabase("temporal-v2-intent-audience");
Bun.env["DATABASE_URL"] = testDatabase.dbUrl;
const { prisma } = testDatabase;

const stubs = vi.hoisted(() => ({
  readChannel: vi.fn(),
  isInstalled: vi.fn(),
  send: vi.fn(),
}));

vi.mock("#src/lib/discord/bot-rest.ts", () => ({
  botRest: () => ({ channel: stubs.readChannel }),
}));
vi.mock("#src/lib/discord/installed-guilds.ts", async () => {
  const actual = await vi.importActual<typeof InstalledGuildsModule>(
    "#src/lib/discord/installed-guilds.ts",
  );
  return { ...actual, isScoutInstalledInGuild: stubs.isInstalled };
});
// What the send delivers is the delivery suites' subject, not this one's: the
// message is a fixed one, and the send is a stub that records it was reached.
vi.mock("#src/temporal/v2/notification/notification-message.ts", () => ({
  buildAttestedMessageV2: () =>
    Promise.resolve({ content: "a live audience hears about its game" }),
}));
vi.mock("#src/discord/utils/channel.ts", () => ({
  fetchChannelForDelivery: () => Promise.resolve({ guildId: undefined }),
}));
vi.mock("#src/discord/client.ts", () => ({ client: {} }));
vi.mock("#src/league/discord/channel.ts", async () => {
  const { channelModuleWithSend } =
    await import("#src/temporal/v2/notification-delivery.test-fixtures.ts");
  return await channelModuleWithSend(stubs.send);
});

// Everything that can reach the production client is imported only after
// DATABASE_URL points at this suite's database.
const { prisma: activityPrisma } = await import("#src/database/index.ts");
const { getIntent } =
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
const { beginNotificationSendV2, recordNotificationOutcomeV2 } =
  await import("#src/temporal/v2/notification-transitions.ts");
const { deliverNotificationV2 } =
  await import("#src/temporal/v2/notification-delivery.ts");
const { scoutDurableNotificationIntentsRetired } =
  await import("#src/metrics/durable-pipeline.ts");

afterAll(async () => {
  await prisma.$disconnect();
  await activityPrisma.$disconnect();
});

const MATCH = "NA1_9400";
const CHANNEL = testChannelId("9400");
const GUILD = testGuildId("9400");
const PUUID = testPuuid("9400");
const NONCE_A = NotificationAttemptNonceSchema.parse("audience-attempt-a");
const NONCE_B = NotificationAttemptNonceSchema.parse("audience-attempt-b");

function attempt(
  intentKey: NotificationIntentKey,
  attemptNonce: NotificationAttemptNonce,
): ScoutIntentAttemptRefV2 {
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
  await seedTrackedAccount(prisma, { matchId: MATCH, puuid: PUUID });
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
  scoutDurableNotificationIntentsRetired.reset();
  stubs.readChannel.mockResolvedValue(liveChannel());
  stubs.isInstalled.mockResolvedValue(true);
  stubs.send.mockResolvedValue({ id: "100000000000000888" });
});

describe("beginNotificationSendV2 and a deleted audience", () => {
  test("a deleted subscription retires instead of beginning a send", async () => {
    const subscriptionId = await seedLiveAudience();
    const key = await readyIntent("deleted-subscription");
    await prisma.subscription.delete({ where: { id: subscriptionId } });

    const begun = await beginNotificationSendV2(attempt(key, NONCE_A));

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
    expect(await beginNotificationSendV2(attempt(key, NONCE_A))).toMatchObject({
      commit: { outcome: "conflict", reason: "terminal-state" },
      state: retired,
    });
    expect(await retiredCount("subscription-deleted")).toBe(1);
  });

  test("a live audience still delivers", async () => {
    await seedLiveAudience();
    const key = await readyIntent("live");

    const begun = await beginNotificationSendV2(attempt(key, NONCE_A));
    expect(begun.commit).toEqual({ outcome: "applied" });
    expect(begun.state).toMatchObject({
      kind: "sending",
      attemptNonce: NONCE_A,
    });
    expect(stubs.isInstalled).toHaveBeenCalledWith(GUILD);

    const delivery = await deliverNotificationV2(attempt(key, NONCE_A));
    expect(delivery).toEqual({
      outcome: "delivered",
      messageId: "100000000000000888",
    });
    const recorded = await recordNotificationOutcomeV2({
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

    const begun = await beginNotificationSendV2(attempt(key, NONCE_A));

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

    const begun = await beginNotificationSendV2(attempt(key, NONCE_A));

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

    const begun = await beginNotificationSendV2(attempt(key, NONCE_A));

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

    const begun = await beginNotificationSendV2(attempt(key, NONCE_A));

    expect(begun.state).toMatchObject({ kind: "sending" });
  });

  test("an unreachable Discord is no evidence", async () => {
    await seedLiveAudience();
    const key = await readyIntent("unreachable");
    stubs.readChannel.mockRejectedValue(
      new DiscordUpstreamError("http_error", "Missing Access", 403),
    );

    const begun = await beginNotificationSendV2(attempt(key, NONCE_A));

    expect(begun.state).toMatchObject({ kind: "sending" });
    expect(stubs.isInstalled).not.toHaveBeenCalled();
  });

  test("an in-flight send is never retired", async () => {
    const subscriptionId = await seedLiveAudience();
    const key = await readyIntent("in-flight");
    const begun = await beginNotificationSendV2(attempt(key, NONCE_A));
    expect(begun.state).toMatchObject({ kind: "sending" });
    const before = await stored(key);
    vi.clearAllMocks();

    // The whole audience goes while the attempt is in flight.
    await prisma.subscription.delete({ where: { id: subscriptionId } });
    stubs.readChannel.mockResolvedValue(null);

    expect(await beginNotificationSendV2(attempt(key, NONCE_A))).toEqual({
      commit: { outcome: "already-applied" },
      state: before.state,
      attemptCount: 1,
    });
    expect(await beginNotificationSendV2(attempt(key, NONCE_B))).toEqual({
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
    await beginNotificationSendV2(attempt(key, NONCE_A));
    await recordNotificationOutcomeV2({
      ...attempt(key, NONCE_A),
      delivery: { outcome: "unknown" },
    });
    const before = await stored(key);
    await prisma.subscription.delete({ where: { id: subscriptionId } });
    stubs.readChannel.mockResolvedValue(null);

    const refused = await beginNotificationSendV2(attempt(key, NONCE_B));

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

    const begun = await beginNotificationSendV2(attempt(key, NONCE_A));

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
