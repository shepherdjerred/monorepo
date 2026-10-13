import { afterAll, beforeEach, expect, test } from "vitest";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
} from "#src/testing/test-ids.ts";
import { clearCustomsTestData } from "#src/customs/test-database.ts";
import { createCustomNight } from "#src/customs/repository.ts";
import {
  seedCustomOperation,
  customVoicePortFixture,
} from "#src/customs/operations/operations.test-fixtures.ts";
import { executeCustomOperationWithPort } from "#src/customs/operations/execution.ts";
import { expireDurableCustomNights } from "#src/customs/game/expiry.ts";
import { commitCustomVoiceResolution } from "#src/customs/operations/resolution.ts";
import { customTeamChannelName } from "#src/customs/operations/channel-name.ts";
import { CustomOperationProgressSchema } from "#src/customs/operations/contracts.ts";
import { readPendingCustomCleanups } from "#src/customs/operations/pending-cleanups.ts";

const { prisma: db } = createTestDatabase("custom-held-expiry");
const now = new Date();
const host = testAccountId("8500");
beforeEach(async () => {
  await clearCustomsTestData(db);
  await db.scoutWorkflowStart.deleteMany();
});
afterAll(async () => await db.$disconnect());

async function expireHeldNight() {
  const seeded = await seedCustomOperation(db, host, now);
  const voice = customVoicePortFixture();
  voice.createTeam.mockRejectedValueOnce(
    new Error("Channel creation acknowledgment lost"),
  );
  await executeCustomOperationWithPort(
    db,
    seeded.operationId,
    async () => voice,
  );
  await db.customNight.update({
    where: { id: seeded.snapshot.id },
    data: { expiresAt: now },
  });
  await expireDurableCustomNights(db, now);
  const night = await db.customNight.findUniqueOrThrow({
    where: { id: seeded.snapshot.id },
  });
  const operation = await db.customNightOperation.findUniqueOrThrow({
    where: { id: seeded.operationId },
  });
  return { ...seeded, night, operation };
}

test("held expiry releases the guild and retains uncertainty until a manager can clean up", async () => {
  const seeded = await expireHeldNight();
  expect(seeded.night.state).toBe("ENDED");
  expect(seeded.night.endedAt).toEqual(now);
  expect(seeded.operation.state).toBe("held");
  expect(
    CustomOperationProgressSchema.parse(JSON.parse(seeded.operation.progress)),
  ).toMatchObject({ expiredAt: now.toISOString(), creating: "A" });
  expect(await db.customActiveNight.count()).toBe(0);
  const game = await db.customGame.findUniqueOrThrow({
    where: { id: seeded.gameId },
  });
  expect(game.state).toBe("VOID");
  expect(game.voiceState).not.toBe("CLEANED_UP");
  const next = await createCustomNight(db, {
    guildId: testGuildId("8501"),
    guildName: "Test Guild",
    launchChannelId: testChannelId("8502"),
    voiceLobbyChannelId: testChannelId("8503"),
    hostDiscordId: host,
    hostDisplayName: "Host",
    hostAvatarUrl: undefined,
    disclosureVersion: "2026-08-29",
    now,
  });
  const actor = {
    discordId: host,
    guildId: testGuildId("8501"),
    channelId: testChannelId("8502"),
    guildName: "Test Guild",
    displayName: "Host",
    avatarUrl: undefined,
    administrator: false,
  };
  const recoverable = await readPendingCustomCleanups(db, actor);
  expect(recoverable).toHaveLength(1);
  expect(recoverable[0]).toMatchObject({
    id: seeded.night.id,
    state: "ENDED",
    pendingOperation: { action: "expire", state: "held" },
  });
  expect(
    await readPendingCustomCleanups(db, {
      ...actor,
      discordId: testAccountId("8599"),
    }),
  ).toEqual([]);
  expect(
    await readPendingCustomCleanups(db, {
      ...actor,
      guildId: testGuildId("8599"),
      administrator: true,
    }),
  ).toEqual([]);
  const channelId = testChannelId("8601");
  await commitCustomVoiceResolution(
    db,
    {
      nightId: seeded.night.id,
      expectedRevision: seeded.night.revision,
      operationId: seeded.operationId,
      evidence:
        "Inspected the expired night's exact Team A channel for cleanup.",
      answer: { kind: "channel-created", channelId },
    },
    host,
    async () => [
      {
        id: channelId,
        name: customTeamChannelName(seeded.operationId, 1, "A"),
        type: 2,
        permission_overwrites: [],
      },
    ],
  );
  const voice = customVoicePortFixture();
  await executeCustomOperationWithPort(
    db,
    seeded.operationId,
    async (payload) => {
      expect(payload.action).toBe("expire");
      expect(payload.snapshot.teamAVoiceChannelId).toBe(channelId);
      return voice;
    },
  );
  expect(voice.createTeam).not.toHaveBeenCalled();
  expect(voice.deleteChannel).toHaveBeenCalledExactlyOnceWith(channelId);
  const cleaned = await db.customNight.findUniqueOrThrow({
    where: { id: seeded.night.id },
  });
  expect(cleaned.state).toBe("ENDED");
  expect(cleaned.endedAt).toEqual(now);
  const active = await db.customActiveNight.findUniqueOrThrow({
    where: { guildId: testGuildId("8501") },
  });
  expect(active.nightId).toBe(next.id);
  const operation = await db.customNightOperation.findUniqueOrThrow({
    where: { id: seeded.operationId },
  });
  expect(operation.state).toBe("completed");
  expect(await readPendingCustomCleanups(db, actor)).toEqual([]);
});

test("confirmed absence after expiry never retries the original channel creation", async () => {
  const seeded = await expireHeldNight();
  await expireDurableCustomNights(db, now);
  expect(
    await db.customAuditEvent.count({
      where: { nightId: seeded.night.id, action: "NIGHT_EXPIRED" },
    }),
  ).toBe(1);
  await commitCustomVoiceResolution(
    db,
    {
      nightId: seeded.night.id,
      expectedRevision: seeded.night.revision,
      operationId: seeded.operationId,
      evidence:
        "Fresh channel inspection confirmed the expired creation never happened.",
      answer: { kind: "confirmed-unsent" },
    },
    host,
    async () => [],
  );
  const voice = customVoicePortFixture();
  await executeCustomOperationWithPort(
    db,
    seeded.operationId,
    async () => voice,
  );
  expect(voice.createTeam).not.toHaveBeenCalled();
  expect(voice.deleteChannel).not.toHaveBeenCalled();
  const night = await db.customNight.findUniqueOrThrow({
    where: { id: seeded.night.id },
  });
  expect(night.state).toBe("ENDED");
});
