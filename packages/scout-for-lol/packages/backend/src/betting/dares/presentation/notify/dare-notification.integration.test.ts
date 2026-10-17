import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  PlayerIdSchema,
} from "@scout-for-lol/data";
import { mintDareStatusIntents } from "#src/betting/dares/presentation/notify/dare-status-intent.ts";
import { dareStatusAnnouncementCodec } from "#src/betting/dares/presentation/notify/dare-status-message.ts";
import { notificationIntentRowToRecord } from "#src/database/durable/intent-row.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { bucksTestDiscordId } from "#src/testing/bucks-fixtures.ts";

const { prisma: db } = createTestDatabase("dare-status-intents");
const SERVER = DiscordGuildIdSchema.parse("1337623164146155593");
const CHALLENGER = bucksTestDiscordId(61);
const TARGET = bucksTestDiscordId(62);
const LATE_TARGET = bucksTestDiscordId(63);
const NOW = new Date("2026-09-03T00:00:00.000Z");

async function seedDare(): Promise<number> {
  const dare = await db.bucksDare.create({
    data: {
      serverId: SERVER,
      channelId: DiscordChannelIdSchema.parse("1337623164146155594"),
      challengerDiscordId: CHALLENGER,
      openingStake: 10,
    },
  });
  await db.bucksDareTarget.createMany({
    data: [
      {
        dareId: dare.id,
        targetKey: "challenger-too",
        discordId: CHALLENGER,
        playerId: PlayerIdSchema.parse(1),
        alias: "challenger",
        accounts: "[]",
      },
      {
        dareId: dare.id,
        targetKey: "target",
        discordId: TARGET,
        playerId: PlayerIdSchema.parse(2),
        alias: "target",
        accounts: "[]",
      },
    ],
  });
  return dare.id;
}

async function mint(
  dareId: number,
  summary = "One win remains.",
): Promise<void> {
  await db.$transaction(async (tx) => {
    await mintDareStatusIntents(tx, {
      dareId,
      revision: 1,
      category: "progress",
      kind: "advanced",
      matchId: RiotMatchIdSchema.parse("NA1_9100000000"),
      summary,
      deduplicationKey: `test:${dareId.toString()}:advance`,
      occurredAt: NOW,
    });
  });
}

beforeEach(async () => {
  await db.matchNotificationIntent.deleteMany();
  await db.scoutWorkflowStart.deleteMany();
  await db.bucksDareTarget.deleteMany();
  await db.bucksDare.deleteMany();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("Dare status intents", () => {
  test("freezes and deduplicates involved recipients transactionally", async () => {
    const dareId = await seedDare();
    await mint(dareId);
    await mint(dareId);
    await db.bucksDareTarget.create({
      data: {
        dareId,
        targetKey: "late-target",
        discordId: LATE_TARGET,
        playerId: PlayerIdSchema.parse(3),
        alias: "late target",
        accounts: "[]",
      },
    });
    await mint(dareId, "Progress changed after the first event.");

    const intents = await db.matchNotificationIntent.findMany({
      where: { subjectKind: "dare", subjectId: dareId.toString() },
      orderBy: { targetId: "asc" },
    });
    expect(intents).toHaveLength(2);
    expect(intents.map((row) => row.targetId)).toEqual(
      [CHALLENGER, TARGET].toSorted(),
    );
    expect(
      intents.every(
        (row) => row.kind === "dare-status" && row.targetKind === "dm",
      ),
    ).toBe(true);
    const first = notificationIntentRowToRecord(intents[0]);
    if (!("dareId" in first) || first.intent.announcement === undefined) {
      throw new Error("Expected a Dare status announcement");
    }
    expect(
      dareStatusAnnouncementCodec.parse(first.intent.announcement),
    ).toMatchObject({
      dareId,
      guildId: SERVER,
      category: "progress",
      kind: "advanced",
      summary: "One win remains.",
    });
    expect(
      await db.scoutWorkflowStart.count({
        where: { requestSource: "dare-status:advanced" },
      }),
    ).toBe(2);
  });
});
