import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";
import { testAccountId, testGuildId } from "#src/testing/test-ids.ts";

const trpc = await createOfflineTrpcHarness("install-attribution-router-test");

// Imported AFTER the harness so this module graph sees the harness's mocked
// prisma singleton — a static import would evaluate install-attribution.ts
// against the real database module before vi.doMock runs.
const { mintInstallAttributionToken } =
  await import("#src/analytics/install-attribution.ts");
const { resetInstallAttributionRateLimitForTests } =
  await import("#src/trpc/router/install-attribution.router.ts");

const SERVER_ID = testGuildId("760");
const ACTOR = testAccountId("761");

async function seedInstall() {
  return trpc.prisma.guildInstall.create({
    data: {
      serverId: SERVER_ID,
      serverName: "Router fixture",
      ownerDiscordId: ACTOR,
      addedByDiscordId: ACTOR,
      memberCount: 10,
      installedAt: new Date(),
    },
  });
}

async function mintFor(discordId: string) {
  return mintInstallAttributionToken(
    {
      discordId: testAccountId(discordId),
      surface: "onboarding_wizard",
    },
    { db: trpc.prisma },
  );
}

beforeEach(async () => {
  resetInstallAttributionRateLimitForTests();
  await trpc.prisma.installAttributionToken.deleteMany();
  await trpc.prisma.guildInstall.deleteMany();
});

afterAll(async () => {
  await trpc.prisma.$disconnect();
});

describe("installAttribution.complete", () => {
  test("attributes a fresh install for the session user", async () => {
    await seedInstall();
    const token = await mintFor("761");

    const result = await trpc
      .authedCaller(ACTOR)
      .installAttribution.complete({ state: token, guildId: SERVER_ID });

    expect(result).toEqual({
      outcome: "attributed",
      guildId: SERVER_ID,
      surface: "onboarding_wizard",
    });
    const install = await trpc.prisma.guildInstall.findUniqueOrThrow({
      where: { serverId: SERVER_ID },
    });
    expect(install.attributionSurface).toBe("onboarding_wizard");
  });

  test("returns invalid for a token minted for another user", async () => {
    await seedInstall();
    const token = await mintFor("762");

    const result = await trpc
      .authedCaller(ACTOR)
      .installAttribution.complete({ state: token, guildId: SERVER_ID });

    expect(result).toEqual({ outcome: "invalid" });
  });

  test("rejects anonymous callers", async () => {
    const token = await mintFor("761");

    await expect(
      trpc
        .anonCaller()
        .installAttribution.complete({ state: token, guildId: SERVER_ID }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  test("rate limits repeated calls per caller", async () => {
    const caller = trpc.authedCaller(ACTOR);
    const bogusState = "f".repeat(64);
    for (let i = 0; i < 10; i += 1) {
      await caller.installAttribution.complete({ state: bogusState });
    }

    await seedInstall();
    const token = await mintFor("761");
    const limited = await caller.installAttribution.complete({
      state: token,
      guildId: SERVER_ID,
    });

    expect(limited).toEqual({ outcome: "invalid" });
  });
});
