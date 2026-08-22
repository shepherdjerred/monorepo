import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testAccountId } from "#src/testing/test-ids.ts";
import { recordUserSeen } from "#src/trpc/context.ts";

const { prisma } = createTestDatabase("context-last-seen-test");
const DISCORD_ID = testAccountId("990");

async function seedUser(lastSeenAt: Date | null) {
  return prisma.user.create({
    data: {
      discordId: DISCORD_ID,
      discordUsername: "last-seen-fixture",
      ...(lastSeenAt === null ? {} : { lastSeenAt }),
    },
  });
}

beforeEach(async () => {
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("recordUserSeen", () => {
  test("stamps lastSeenAt on first authenticated request", async () => {
    const user = await seedUser(null);
    const now = new Date("2026-08-22T12:00:00Z");

    await recordUserSeen(user, prisma, now);

    const updated = await prisma.user.findUniqueOrThrow({
      where: { discordId: DISCORD_ID },
    });
    expect(updated.lastSeenAt).toEqual(now);
  });

  test("throttles to one write per hour", async () => {
    const lastSeen = new Date("2026-08-22T12:00:00Z");
    const user = await seedUser(lastSeen);

    await recordUserSeen(user, prisma, new Date("2026-08-22T12:59:59Z"));

    const untouched = await prisma.user.findUniqueOrThrow({
      where: { discordId: DISCORD_ID },
    });
    expect(untouched.lastSeenAt).toEqual(lastSeen);
  });

  test("writes again once the hour has passed", async () => {
    const lastSeen = new Date("2026-08-22T12:00:00Z");
    const user = await seedUser(lastSeen);
    const later = new Date("2026-08-22T13:00:00Z");

    await recordUserSeen(user, prisma, later);

    const updated = await prisma.user.findUniqueOrThrow({
      where: { discordId: DISCORD_ID },
    });
    expect(updated.lastSeenAt).toEqual(later);
  });

  test("never throws when the user row is gone", async () => {
    await expect(
      recordUserSeen(
        { discordId: DISCORD_ID, lastSeenAt: null },
        prisma,
        new Date(),
      ),
    ).resolves.toBeUndefined();
  });
});
