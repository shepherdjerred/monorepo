import { afterAll, beforeEach, describe, expect, test } from "vitest";
import {
  createTestDatabase,
  deleteIfExists,
} from "#src/testing/test-database.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";
import { addSubscription } from "#src/lib/subscription/add.ts";

const { prisma } = createTestDatabase("subscription-initial-history");
const guildId = testGuildId("7100");
const channelId = testChannelId("7200");
const creatorDiscordId = testAccountId("7300");

beforeEach(async () => {
  await deleteIfExists(() => prisma.initialMatchHistoryImport.deleteMany());
  await deleteIfExists(() => prisma.subscription.deleteMany());
  await deleteIfExists(() => prisma.account.deleteMany());
  await deleteIfExists(() => prisma.player.deleteMany());
});

afterAll(async () => {
  await prisma.$disconnect();
});

function input(gameName: string) {
  return {
    guildId,
    channelId,
    region: "AMERICA_NORTH" as const,
    riotId: { game_name: gameName, tag_line: "NA1" },
    alias: "Tracked Player",
    creatorDiscordId,
    filters: null,
  };
}

describe("subscription initial history enqueue", () => {
  test("enqueues in the same transaction when enabled", async () => {
    const puuid = testPuuid("subscription-history");
    const result = await prisma.$transaction((tx) =>
      addSubscription(input("HistoryMain"), puuid, tx, true),
    );

    expect(result.kind).toBe("created");
    expect(
      await prisma.initialMatchHistoryImport.findUnique({ where: { puuid } }),
    ).toMatchObject({ phase: "queued" });
  });

  test("does not enqueue when disabled", async () => {
    const puuid = testPuuid("subscription-legacy");
    const result = await prisma.$transaction((tx) =>
      addSubscription(input("LegacyMain"), puuid, tx, false),
    );

    expect(result.kind).toBe("created");
    expect(
      await prisma.initialMatchHistoryImport.findUnique({ where: { puuid } }),
    ).toBeNull();
  });

  test("enqueues an additional account even when the channel subscription exists", async () => {
    const firstPuuid = testPuuid("subscription-first");
    const secondPuuid = testPuuid("subscription-second");
    await prisma.$transaction((tx) =>
      addSubscription(input("FirstMain"), firstPuuid, tx, false),
    );

    const result = await prisma.$transaction((tx) =>
      addSubscription(input("SecondMain"), secondPuuid, tx, true),
    );

    expect(result.kind).toBe("subscription-already-exists");
    expect(
      await prisma.initialMatchHistoryImport.findUnique({
        where: { puuid: secondPuuid },
      }),
    ).toMatchObject({ phase: "queued" });
  });
});
