import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  DiscordChannelIdSchema,
  LeaguePuuidSchema,
} from "@scout-for-lol/data";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  createRiotLinkAttempt,
  completeRiotLink,
  riotLinkDigest,
} from "#src/database/riot-accounts.ts";
import { getChannelsSubscribedToPlayers } from "#src/database/subscribed-channels.ts";
import { channelsPassingQueueFilter } from "#src/league/tasks/notification-filters.ts";
import { matchNotificationPreferenceSuppression } from "#src/temporal/notification/account-preference.ts";
import { MatchNotificationIntentRecordSchema } from "#src/database/durable/intent-row.ts";

const { prisma: db } = createTestDatabase("riot-account-notifications");
const owner = DiscordAccountIdSchema.parse("300000000000000091");
const other = DiscordAccountIdSchema.parse("300000000000000092");
const puuid = LeaguePuuidSchema.parse("Q".repeat(78));
const alt = LeaguePuuidSchema.parse("R".repeat(78));
const now = new Date();

beforeEach(async () => {
  await db.riotOAuthLinkAttempt.deleteMany();
  await db.riotAccountPreference.deleteMany();
  await db.subscription.deleteMany();
  await db.account.deleteMany();
  await db.player.deleteMany();
  await db.user.deleteMany();
  for (const discordId of [owner, other])
    await db.user.create({ data: { discordId, discordUsername: "test-user" } });
});
afterAll(async () => {
  await db.$disconnect();
});

async function verifiedAttempt(
  discordId = owner,
  state = "test-state",
  sessionId = "session-one",
) {
  expect(await createRiotLinkAttempt({ state, discordId, sessionId }, db)).toBe(
    "created",
  );
  await db.riotOAuthLinkAttempt.update({
    where: { stateDigest: riotLinkDigest(state) },
    data: {
      claimedAt: now,
      verifiedPuuid: puuid,
      gameName: "Northstar",
      tagLine: "NA1",
      verifiedAt: now,
    },
  });
  return { state, discordId, sessionId };
}

async function follow(suffix: string, accounts = [puuid]) {
  const guildId = DiscordGuildIdSchema.parse(`1000000000000000${suffix}`);
  const channelId = DiscordChannelIdSchema.parse(`2000000000000000${suffix}`);
  const player = await db.player.create({
    data: {
      alias: `player-${suffix}`,
      serverId: guildId,
      creatorDiscordId: owner,
      createdTime: now,
      updatedTime: now,
    },
  });
  for (const [index, accountPuuid] of accounts.entries())
    await db.account.create({
      data: {
        alias: `account-${index.toString()}`,
        puuid: accountPuuid,
        region: "AMERICA_NORTH",
        playerId: player.id,
        serverId: guildId,
        creatorDiscordId: owner,
        createdTime: now,
        updatedTime: now,
      },
    });
  await db.subscription.create({
    data: {
      playerId: player.id,
      channelId,
      serverId: guildId,
      creatorDiscordId: owner,
      createdTime: now,
      updatedTime: now,
    },
  });
  return channelId;
}

describe("verified Riot ownership", () => {
  test("creates a verified owner without opting out implicitly", async () => {
    expect(await completeRiotLink(await verifiedAttempt(), db)).toBe("linked");
    expect(
      await db.riotAccountPreference.findUnique({ where: { puuid } }),
    ).toMatchObject({ ownerDiscordId: owner, matchNotificationsEnabled: true });
  });
  test("requires the initiating session and consumes a proof only once", async () => {
    const input = await verifiedAttempt();
    expect(
      await completeRiotLink({ ...input, sessionId: "switched-session" }, db),
    ).toBe("expired");
    expect(await completeRiotLink({ ...input, discordId: other }, db)).toBe(
      "expired",
    );
    expect(await completeRiotLink(input, db)).toBe("linked");
    expect(await completeRiotLink(input, db)).toBe("expired");
  });
  test("rejects expired and unverified attempts", async () => {
    const input = await verifiedAttempt();
    await db.riotOAuthLinkAttempt.update({
      where: { stateDigest: riotLinkDigest(input.state) },
      data: { expiresAt: new Date(0) },
    });
    expect(await completeRiotLink(input, db)).toBe("expired");
    const unverified = {
      state: "unverified",
      discordId: owner,
      sessionId: "session-one",
    };
    await createRiotLinkAttempt(unverified, db);
    expect(await completeRiotLink(unverified, db)).toBe("expired");
  });
  test("requires support on an ownership conflict and preserves an existing opt-out", async () => {
    expect(await completeRiotLink(await verifiedAttempt(), db)).toBe("linked");
    await db.riotAccountPreference.update({
      where: { puuid },
      data: { matchNotificationsEnabled: false },
    });
    expect(
      await completeRiotLink(
        await verifiedAttempt(other, "different-user"),
        db,
      ),
    ).toBe("account-conflict");
    expect(
      await completeRiotLink(await verifiedAttempt(owner, "same-user"), db),
    ).toBe("linked");
    expect(
      await db.riotAccountPreference.findUnique({ where: { puuid } }),
    ).toMatchObject({
      ownerDiscordId: owner,
      matchNotificationsEnabled: false,
    });
  });
  test("serializes competing verified ownership claims", async () => {
    const first = await verifiedAttempt(owner, "first");
    const second = await verifiedAttempt(other, "second");
    const results = await Promise.all([
      completeRiotLink(first, db),
      completeRiotLink(second, db),
    ]);
    expect(results.sort()).toEqual(["account-conflict", "linked"]);
  });
  test("bounds new OAuth attempts per user", async () => {
    for (let i = 0; i < 5; i += 1)
      expect(
        await createRiotLinkAttempt(
          {
            state: `attempt-${i.toString()}`,
            discordId: owner,
            sessionId: "session",
          },
          db,
        ),
      ).toBe("created");
    expect(
      await createRiotLinkAttempt(
        { state: "excess", discordId: owner, sessionId: "session" },
        db,
      ),
    ).toBe("rate-limited");
  });
});

async function optOut() {
  await completeRiotLink(await verifiedAttempt(), db);
  await db.riotAccountPreference.update({
    where: { puuid },
    data: { matchNotificationsEnabled: false },
  });
}

describe("global match notification eligibility", () => {
  test("covers every server and later subscriptions without altering tracking", async () => {
    await follow("11");
    await follow("12");
    expect(await getChannelsSubscribedToPlayers([puuid], db)).toHaveLength(2);
    await optOut();
    await follow("13");
    expect(await getChannelsSubscribedToPlayers([puuid], db)).toEqual([]);
    expect(await db.account.count()).toBe(3);
    expect(await db.subscription.count({ where: { isMuted: false } })).toBe(3);
    await db.riotAccountPreference.update({
      where: { puuid },
      data: { matchNotificationsEnabled: true },
    });
    expect(await getChannelsSubscribedToPlayers([puuid], db)).toHaveLength(3);
  });
  test("keeps a shared match eligible through another account of the same player", async () => {
    await follow("11", [puuid, alt]);
    await optOut();
    const channels = await getChannelsSubscribedToPlayers([puuid, alt], db);
    expect(channels).toHaveLength(1);
    expect(channels[0]?.subscriptions).toHaveLength(1);
    expect(channelsPassingQueueFilter(channels, "solo")).toHaveLength(1);
    await db.subscription.updateMany({ data: { isMuted: true } });
    expect(
      channelsPassingQueueFilter(
        await getChannelsSubscribedToPlayers([puuid, alt], db),
        "solo",
      ),
    ).toEqual([]);
  });
  test.each(["prematch", "postmatch"])(
    "rechecks queued %s notices and preserves shared delivery",
    async (kind) => {
      const channelId = await follow("11", [puuid, alt]);
      const record = MatchNotificationIntentRecordSchema.parse({
        matchId: "NA1_123456789",
        intent: {
          key: `${kind}:queued`,
          kind,
          origin: { kind: "live" },
          target: { kind: "channel", channelId },
          freshnessDeadline: "2099-01-01T00:00:00.000Z",
          createdAt: now.toISOString(),
          attemptCount: 0,
          state: { kind: "ready" },
        },
      });
      const solo = async () => ({ puuids: [puuid], queueType: undefined });
      expect(
        await matchNotificationPreferenceSuppression(record, db, solo),
      ).toBeUndefined();
      await optOut();
      expect(
        await matchNotificationPreferenceSuppression(record, db, solo),
      ).toBe("recipient-preference");
      const shared = async () => ({
        puuids: [puuid, alt],
        queueType: undefined,
      });
      expect(
        await matchNotificationPreferenceSuppression(record, db, shared),
      ).toBeUndefined();
      // A muted or differently filtered remaining participant cannot make
      // this queued notice eligible again after the owner opts out.
      await db.subscription.updateMany({ data: { isMuted: true } });
      expect(
        await matchNotificationPreferenceSuppression(record, db, shared),
      ).toBe("recipient-preference");
      await db.subscription.updateMany({
        data: {
          isMuted: false,
          filters: JSON.stringify({
            version: 1,
            filters: [{ type: "queue", queues: ["arena"] }],
          }),
        },
      });
      const soloQueue = async () => ({
        puuids: [puuid, alt],
        queueType: "solo" as const,
      });
      expect(
        await matchNotificationPreferenceSuppression(record, db, soloQueue),
      ).toBe("recipient-preference");
      await db.subscription.deleteMany();
      expect(
        await matchNotificationPreferenceSuppression(record, db, shared),
      ).toBe("recipient-preference");
    },
  );
});
