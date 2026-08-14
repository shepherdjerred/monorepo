import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { resetConfigurationForTests } from "#src/configuration.ts";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";
import { testAccountId, testGuildId } from "#src/testing/test-ids.ts";

/**
 * The harness installs module mocks, so it must run before anything imports
 * the router (see its docblock).
 */
const ALLOWED_GUILD = testGuildId("111111");
const OTHER_GUILD = testGuildId("222222");

const trpc = await createOfflineTrpcHarness("explore-router-test");

const OWNER = testAccountId("900000010");
const STRANGER = testAccountId("900000011");
const SHARER = testAccountId("900000012");
const LOSER = testAccountId("900000013");

function setAllowlist(value: string | undefined): void {
  if (value === undefined) {
    delete Bun.env["EXPLORE_GUILD_ALLOWLIST"];
  } else {
    Bun.env["EXPLORE_GUILD_ALLOWLIST"] = value;
  }
  resetConfigurationForTests();
}

/**
 * The harness builds a context user without a row, but ExploreConversation has
 * a real FK to User, so the people these tests act as must exist.
 */
async function seedUsers(): Promise<void> {
  for (const discordId of [OWNER, STRANGER, SHARER, LOSER]) {
    await trpc.prisma.user.upsert({
      where: { discordId },
      create: { discordId, discordUsername: `user-${discordId}` },
      update: {},
    });
  }
}

beforeEach(async () => {
  await trpc.prisma.exploreMessage.deleteMany();
  await trpc.prisma.exploreConversation.deleteMany();
  await seedUsers();
  trpc.setMembership([{ guildId: ALLOWED_GUILD, asAdmin: false }]);
  setAllowlist(ALLOWED_GUILD);
});

afterAll(async () => {
  setAllowlist(undefined);
  await trpc.prisma.$disconnect();
});

describe("explore router", () => {
  test("an anonymous caller is rejected", async () => {
    await expect(trpc.anonCaller().explore.list()).rejects.toThrow();
  });

  test("an unset allowlist denies every signed-in caller", async () => {
    setAllowlist(undefined);
    const caller = trpc.authedCaller();

    expect(await caller.explore.status()).toEqual({
      enabled: false,
      quota: [],
    });
    await expect(caller.explore.list()).rejects.toThrow(/not enabled/i);
  });

  test("membership in no allowlisted server denies access", async () => {
    setAllowlist(OTHER_GUILD);
    const caller = trpc.authedCaller();

    const status = await caller.explore.status();
    expect(status.enabled).toBe(false);
    await expect(caller.explore.list()).rejects.toThrow(/limited to a few/i);
  });

  test("membership in an allowlisted server grants access", async () => {
    const caller = trpc.authedCaller();

    const status = await caller.explore.status();
    expect(status.enabled).toBe(true);
    expect(status.quota.length).toBeGreaterThan(0);
    expect(await caller.explore.list()).toEqual([]);
  });

  test("a conversation is not visible to another signed-in user", async () => {
    const owner = trpc.authedCaller(OWNER);
    const conversation = await trpc.prisma.exploreConversation.create({
      data: {
        userId: OWNER,
        title: "Mine",
        messages: {
          create: { ordinal: 0, role: "user", content: "Which champion?" },
        },
      },
    });

    expect(await owner.explore.list()).toHaveLength(1);

    const stranger = trpc.authedCaller(STRANGER);
    expect(await stranger.explore.list()).toEqual([]);
    await expect(
      stranger.explore.get({ conversationId: conversation.id }),
    ).rejects.toThrow(/not found/i);
    await expect(
      stranger.explore.delete({ conversationId: conversation.id }),
    ).rejects.toThrow(/not found/i);
    await expect(
      stranger.explore.share({ conversationId: conversation.id }),
    ).rejects.toThrow(/not found/i);
  });

  test("sharing returns a token and revoking clears it", async () => {
    const caller = trpc.authedCaller(SHARER);
    const conversation = await trpc.prisma.exploreConversation.create({
      data: {
        userId: SHARER,
        title: "Shared",
        messages: {
          create: { ordinal: 0, role: "user", content: "Which champion?" },
        },
      },
    });

    const { shareToken } = await caller.explore.share({
      conversationId: conversation.id,
    });
    expect(shareToken).toMatch(/^[0-9a-f]{32}$/);

    await caller.explore.revokeShare({ conversationId: conversation.id });
    const after = await trpc.prisma.exploreConversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
    expect(after.shareToken).toBeNull();
  });

  test("losing allowlisted membership revokes access to existing conversations", async () => {
    const caller = trpc.authedCaller(LOSER);
    await trpc.prisma.exploreConversation.create({
      data: {
        userId: LOSER,
        title: "Mine",
        messages: {
          create: { ordinal: 0, role: "user", content: "Which champion?" },
        },
      },
    });
    expect(await caller.explore.list()).toHaveLength(1);

    // The allowlist is re-checked per request rather than at creation time.
    trpc.setMembership([{ guildId: OTHER_GUILD, asAdmin: false }]);
    await expect(caller.explore.list()).rejects.toThrow(/limited to a few/i);
  });
});
