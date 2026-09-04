import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  COMPETITIVE_PROGRESSION_CATALOG_VERSION,
  HallSettingsSchema,
} from "@scout-for-lol/data";
import {
  requestFullHallBaseline,
  updateHallSettings,
} from "#src/progression/hall/settings.ts";
import {
  createTestDatabase,
  dropTestDatabase,
} from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
} from "#src/testing/test-ids.ts";

const { prisma: db, dbPath } = createTestDatabase("hall-settings");
const GUILD_ID = testGuildId("711");
const ACTOR_ID = testAccountId("711");

beforeEach(async () => {
  await db.hallRecordBreakOutbox.deleteMany();
  await db.hallSettings.deleteMany();
});

afterAll(async () => {
  await dropTestDatabase(db, dbPath);
});

describe("Hall settings persistence", () => {
  test("normalizes catalog order and baselines every newly enabled cell", async () => {
    const result = await updateHallSettings(db, {
      settings: HallSettingsSchema.parse({
        guildId: GUILD_ID,
        catalogVersion: COMPETITIVE_PROGRESSION_CATALOG_VERSION,
        channelId: testChannelId("711"),
        enabledQueueFamilies: ["aram", "ranked_sr"],
        enabledRecords: ["assists", "kills"],
      }),
      actorDiscordId: ACTOR_ID,
      stage: "beta",
    });

    expect(result.settings.enabledQueueFamilies).toEqual(["ranked_sr", "aram"]);
    expect(result.settings.enabledRecords).toEqual(["kills", "assists"]);
    expect(result.baseline).toMatchObject({ revision: 1, reused: false });
    expect(await db.hallRecordCell.count()).toBe(4);
    expect(
      await db.hallRecordCell.count({
        where: { baselineStatus: "building", baselineRevision: 1 },
      }),
    ).toBe(4);
  });

  test("serializes concurrent full-baseline requests onto one active run", async () => {
    await updateHallSettings(db, {
      settings: HallSettingsSchema.parse({
        guildId: GUILD_ID,
        catalogVersion: COMPETITIVE_PROGRESSION_CATALOG_VERSION,
        channelId: null,
        enabledQueueFamilies: ["aram"],
        enabledRecords: ["kills"],
      }),
      actorDiscordId: ACTOR_ID,
      stage: "beta",
    });
    await db.hallBaselineRun.updateMany({
      data: { baselineState: "ready", completedAt: new Date() },
    });

    const requests = await Promise.all(
      [1, 2].map(
        async () =>
          await requestFullHallBaseline(db, {
            guildId: GUILD_ID,
            actorDiscordId: ACTOR_ID,
            stage: "beta",
          }),
      ),
    );

    expect(new Set(requests.map((request) => request.workflowId)).size).toBe(1);
    expect(
      requests
        .map((request) => request.reused)
        .toSorted((left, right) => Number(left) - Number(right)),
    ).toEqual([false, true]);
    expect(
      await db.hallBaselineRun.count({
        where: { guildId: GUILD_ID, baselineState: "building" },
      }),
    ).toBe(1);
  });

  test("re-enabling a Hall cell starts a silent fresh baseline revision", async () => {
    const base = HallSettingsSchema.parse({
      guildId: GUILD_ID,
      catalogVersion: COMPETITIVE_PROGRESSION_CATALOG_VERSION,
      channelId: null,
      enabledQueueFamilies: ["ranked_sr", "aram"],
      enabledRecords: ["kills"],
    });
    await updateHallSettings(db, {
      settings: base,
      actorDiscordId: ACTOR_ID,
      stage: "beta",
    });
    const disabled = await updateHallSettings(db, {
      settings: { ...base, enabledQueueFamilies: ["ranked_sr"] },
      actorDiscordId: ACTOR_ID,
      stage: "beta",
    });
    expect(disabled.baseline).toBeNull();

    const reenabled = await updateHallSettings(db, {
      settings: base,
      actorDiscordId: ACTOR_ID,
      stage: "beta",
    });
    expect(reenabled.baseline).toMatchObject({ revision: 2, reused: false });
    expect(
      await db.hallRecordCell.findUniqueOrThrow({
        where: {
          guildId_queueFamilyId_recordId: {
            guildId: GUILD_ID,
            queueFamilyId: "aram",
            recordId: "kills",
          },
        },
      }),
    ).toMatchObject({ baselineStatus: "building", baselineRevision: 2 });
  });

  test("does not mistake an active partial baseline for a full baseline", async () => {
    const base = {
      guildId: GUILD_ID,
      catalogVersion: COMPETITIVE_PROGRESSION_CATALOG_VERSION,
      channelId: null,
      enabledQueueFamilies: ["aram"],
    } as const;
    await updateHallSettings(db, {
      settings: HallSettingsSchema.parse({
        ...base,
        enabledRecords: ["kills"],
      }),
      actorDiscordId: ACTOR_ID,
      stage: "beta",
    });
    await updateHallSettings(db, {
      settings: HallSettingsSchema.parse({
        ...base,
        enabledRecords: ["kills", "assists"],
      }),
      actorDiscordId: ACTOR_ID,
      stage: "beta",
    });

    const request = await requestFullHallBaseline(db, {
      guildId: GUILD_ID,
      actorDiscordId: ACTOR_ID,
      stage: "beta",
    });

    expect(request).toMatchObject({ revision: 3, reused: false });
    expect(
      await db.hallRecordCell.count({
        where: { guildId: GUILD_ID, baselineRevision: 3 },
      }),
    ).toBe(2);
  });
});
