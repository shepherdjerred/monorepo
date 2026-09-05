import { afterEach, describe, expect, test } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  createPermissionSet,
  P,
  rootPermissions,
  type DiscordGuildId,
  type PermissionSet,
} from "@scout-for-lol/data";
import type { User } from "#generated/prisma/client/index.js";
import {
  addFlagOverride,
  clearFlagOverrides,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import {
  resolveCreationAccess,
  resolveCreationCapability,
  type CreationAccess,
  type CreationCapability,
} from "#src/explore/creation/capability.ts";
import {
  createCreationExploreTools,
  createCreationToolExecutors,
} from "#src/explore/creation/tools.ts";
import { testAccountId, testGuildId } from "#src/testing/test-ids.ts";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";

const ENABLED_GUILD = testGuildId("510001");
const OTHER_GUILD = testGuildId("510002");
const REQUESTER = testAccountId("910000101");

const passthroughTracker: ToolTracker = async (_toolName, work) => await work();

afterEach(() => {
  resetFlagOverrides("explore_creation_enabled");
});

function testUser(): User {
  return {
    discordId: REQUESTER,
    discordUsername: "creation-test",
    discordAvatar: null,
    discordAccessToken: null,
    discordRefreshToken: null,
    tokenExpiresAt: null,
    analyticsUserId: `analytics-${REQUESTER}`,
    lastSeenAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

type AccessCounters = { oauth: number; permission: number };

/**
 * The real Tier-2 resolver with its two expensive seams counted, so a test can
 * assert not only what came back but that nothing was paid for.
 */
function countedAccess(
  counters: AccessCounters,
  permissions: (guildId: DiscordGuildId) => Promise<PermissionSet>,
  onFetch: () => Promise<void> = () => Promise.resolve(),
) {
  return (input: {
    capability: CreationCapability;
    requesterId: typeof REQUESTER;
  }): Promise<CreationAccess> =>
    resolveCreationAccess(input, {
      loadUser: () => Promise.resolve(testUser()),
      fetchUserGuilds: async () => {
        counters.oauth += 1;
        await onFetch();
        return [];
      },
      resolvePermissions: async (_user, guildId) => {
        counters.permission += 1;
        return await permissions(guildId);
      },
      guildName: (guildId) => `Guild ${guildId}`,
    });
}

describe("resolveCreationCapability", () => {
  test("returns null when no guild in scope has creation enabled", async () => {
    clearFlagOverrides("explore_creation_enabled");
    await expect(
      resolveCreationCapability({
        surface: "web",
        guildIds: [ENABLED_GUILD, OTHER_GUILD],
      }),
    ).resolves.toBeNull();
  });

  test("keeps only the guilds the flag is on for", async () => {
    clearFlagOverrides("explore_creation_enabled");
    addFlagOverride("explore_creation_enabled", true, {
      server: ENABLED_GUILD,
    });
    await expect(
      resolveCreationCapability({
        surface: "web",
        guildIds: [OTHER_GUILD, ENABLED_GUILD],
      }),
    ).resolves.toEqual({ guildIds: [ENABLED_GUILD] });
  });

  test("Discord is never a creation surface, however the flag is set", async () => {
    clearFlagOverrides("explore_creation_enabled");
    addFlagOverride("explore_creation_enabled", true, {
      server: ENABLED_GUILD,
    });
    await expect(
      resolveCreationCapability({
        surface: "discord",
        guildIds: [ENABLED_GUILD],
      }),
    ).resolves.toBeNull();
  });
});

describe("creation tool registration", () => {
  test("the flag off means no tools AND no permission I/O at all", async () => {
    // The regression guard for the laziness requirement: an OAuth refresh on
    // the setup path of every Explore turn would let a Discord outage degrade
    // ordinary analytics questions that never touch creation.
    clearFlagOverrides("explore_creation_enabled");
    const counters: AccessCounters = { oauth: 0, permission: 0 };
    const capability = await resolveCreationCapability({
      surface: "web",
      guildIds: [ENABLED_GUILD],
    });
    expect(capability).toBeNull();

    const tools = createCreationExploreTools({
      capability,
      requesterId: REQUESTER,
      track: passthroughTracker,
      dependencies: {
        resolveAccess: countedAccess(counters, () =>
          Promise.resolve(rootPermissions()),
        ),
        listChannels: () => [],
      },
    });

    expect(Object.keys(tools)).toEqual([]);
    expect(counters).toEqual({ oauth: 0, permission: 0 });
  });

  test("registering the tools pays nothing; the first call pays once", async () => {
    clearFlagOverrides("explore_creation_enabled");
    addFlagOverride("explore_creation_enabled", true, {
      server: ENABLED_GUILD,
    });
    const counters: AccessCounters = { oauth: 0, permission: 0 };
    const capability = await resolveCreationCapability({
      surface: "web",
      guildIds: [ENABLED_GUILD],
    });
    expect(capability).not.toBeNull();

    const tools = createCreationExploreTools({
      capability,
      requesterId: REQUESTER,
      track: passthroughTracker,
      dependencies: {
        // No permissions, so the limit previews never reach the database.
        resolveAccess: countedAccess(counters, () =>
          Promise.resolve(createPermissionSet([])),
        ),
        listChannels: () => [],
      },
    });
    expect(Object.keys(tools).toSorted()).toEqual([
      "list_creation_targets",
      "list_guild_channels",
      "prepare_competition_creation",
      "prepare_report_creation",
      "prepare_subscription_creation",
    ]);
    // Building the toolset is Tier 1 only.
    expect(counters).toEqual({ oauth: 0, permission: 0 });
  });

  test("the first creation call resolves permissions once for the turn", async () => {
    const counters: AccessCounters = { oauth: 0, permission: 0 };
    // The executors behind the tool wrappers, so the assertion is about the
    // memoization rather than about the AI SDK's call plumbing.
    const executors = createCreationToolExecutors({
      capability: { guildIds: [ENABLED_GUILD] },
      requesterId: REQUESTER,
      track: passthroughTracker,
      dependencies: {
        // No permissions, so the limit previews never reach the database.
        resolveAccess: countedAccess(counters, () =>
          Promise.resolve(createPermissionSet([])),
        ),
        listChannels: () => [],
      },
    });
    expect(counters).toEqual({ oauth: 0, permission: 0 });

    const first = await executors.listTargets();
    expect(first).toMatchObject({ kind: "targets" });
    expect(counters).toEqual({ oauth: 1, permission: 1 });

    // Memoized for the turn: a second creation tool reuses the resolution.
    await executors.listTargets();
    expect(counters).toEqual({ oauth: 1, permission: 1 });
  });
});

describe("resolveCreationAccess", () => {
  const capability: CreationCapability = {
    guildIds: [ENABLED_GUILD, OTHER_GUILD],
  };

  test("drops a guild the user has no permission in, keeps the rest", async () => {
    const counters: AccessCounters = { oauth: 0, permission: 0 };
    const access = await countedAccess(counters, (guildId) =>
      guildId === ENABLED_GUILD
        ? Promise.resolve(createPermissionSet([P("reports", "create")]))
        : Promise.reject(
            new TRPCError({
              code: "FORBIDDEN",
              message: "You are not a member of that guild",
            }),
          ),
    )({ capability, requesterId: REQUESTER });

    expect(access.kind).toBe("resolved");
    if (access.kind !== "resolved") return;
    expect(access.guilds.map((guild) => guild.guildId)).toEqual([
      ENABLED_GUILD,
    ]);
    expect(access.guilds[0]?.permissions.can("reports", "create")).toBe(true);
  });

  test("a guild without Scout installed is excluded, not an error", async () => {
    const counters: AccessCounters = { oauth: 0, permission: 0 };
    const access = await countedAccess(counters, () =>
      Promise.reject(
        new TRPCError({
          code: "NOT_FOUND",
          message: "Scout is not installed in that guild",
        }),
      ),
    )({ capability, requesterId: REQUESTER });

    expect(access).toEqual({ kind: "resolved", guilds: [] });
  });

  /** Resolve access against a membership probe that fails with `code`. */
  async function accessUnderOutage(
    code: "SERVICE_UNAVAILABLE" | "UNAUTHORIZED",
    counters: AccessCounters,
  ): Promise<CreationAccess> {
    return await countedAccess(
      counters,
      () => Promise.resolve(rootPermissions()),
      () => Promise.reject(new TRPCError({ code, message: "Discord said no" })),
    )({ capability, requesterId: REQUESTER });
  }

  test("a Discord outage says 'couldn't verify', never a denial", async () => {
    // The failure this whole design forbids: reporting an outage as "you have
    // no permission" tells the user to stop trying rather than to retry.
    const counters: AccessCounters = { oauth: 0, permission: 0 };
    const access = await accessUnderOutage("SERVICE_UNAVAILABLE", counters);

    expect(access.kind).toBe("verification_unavailable");
    if (access.kind !== "verification_unavailable") return;
    expect(access.message).toContain("could not reach Discord");
    // The message must steer the model away from a permission answer rather
    // than merely avoid the word.
    expect(access.message).toContain("Do not tell them they lack permission");
    // No guild was ever attributed a decision.
    expect(counters.permission).toBe(0);
  });

  test("an expired Discord grant is also 'couldn't verify'", async () => {
    const counters: AccessCounters = { oauth: 0, permission: 0 };
    const access = await accessUnderOutage("UNAUTHORIZED", counters);

    expect(access.kind).toBe("verification_unavailable");
  });

  test("an unexpected error propagates rather than reading as a denial", async () => {
    const counters: AccessCounters = { oauth: 0, permission: 0 };
    await expect(
      countedAccess(counters, () =>
        Promise.reject(new Error("prisma exploded")),
      )({ capability, requesterId: REQUESTER }),
    ).rejects.toThrow("prisma exploded");
  });
});
