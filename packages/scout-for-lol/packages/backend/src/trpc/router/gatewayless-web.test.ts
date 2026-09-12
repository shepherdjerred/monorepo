/**
 * The web API answered with NO Discord gateway client at all.
 *
 * The harness below deliberately does not stub `client.guilds` — reading it
 * throws — so any web-serving path that regressed to the gateway cache fails
 * here rather than silently working in a combined-mode dev process and handing
 * out NOT_FOUNDs on a gatewayless pod. Everything Discord-shaped comes from the
 * bot REST port; installation comes from the real `GuildInstall` port running
 * against a real table.
 */

import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { ChannelType, PermissionFlagsBits } from "discord.js";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  permissionKey,
  type Permission,
} from "@scout-for-lol/data";
import type { User } from "#generated/prisma/client/index.js";
import type { AppRouter } from "#src/trpc/router/index.ts";
import type { PartialGuild } from "#src/lib/discord-rest.ts";
import type { BotRestReader } from "#src/lib/discord/bot-rest.ts";
import type { DiscordGuildChannel } from "#src/lib/discord/bot-rest-schemas.ts";
import { DiscordUpstreamError } from "#src/lib/discord-rest.ts";
import * as databaseModule from "#src/database/index.ts";
import * as discordUpstreamModule from "#src/trpc/discord-upstream.ts";
import configuration from "#src/configuration.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

const { prisma } = createTestDatabase("gatewayless-web");

const INSTALLED = DiscordGuildIdSchema.parse("100000000000009101");
const UNROWED = DiscordGuildIdSchema.parse("100000000000009102");
const GONE = DiscordGuildIdSchema.parse("100000000000009103");
const ACTOR = DiscordAccountIdSchema.parse("900000000000009001");
const PEER = DiscordAccountIdSchema.parse("900000000000009002");
const BOT = "900000000000000000";
const BOT_ROLE = "100000000000009901";
const TRACKED_ALIAS = "virmel";
const POSTABLE_CHANNEL = DiscordChannelIdSchema.parse("100000000000009201");
const MUTED_CHANNEL = DiscordChannelIdSchema.parse("100000000000009202");
const FOREIGN_CHANNEL = DiscordChannelIdSchema.parse("100000000000009203");

function postableChannel(id: string, name: string): DiscordGuildChannel {
  return { id, name, type: ChannelType.GuildText, permission_overwrites: [] };
}

/**
 * A text channel Scout can see but not speak in.
 *
 * The picker has always filtered these out; the shape of the failure is that
 * the mutation guard did not, so the two disagreed about the same channel.
 */
function mutedChannel(): DiscordGuildChannel {
  return {
    id: MUTED_CHANNEL,
    name: "announcements-only",
    type: ChannelType.GuildText,
    permission_overwrites: [
      {
        id: BOT_ROLE,
        type: 0,
        allow: "0",
        deny: PermissionFlagsBits.SendMessages.toString(),
      },
    ],
  };
}

type RestState = {
  guildsOnDiscord: Set<string>;
  /** What a cached (`guildMember`) read sees. */
  members: Map<string, Set<string>>;
  /** What an uncached (`freshGuildMember`) read sees; null = same as cached. */
  freshMembers: Map<string, Set<string>> | null;
  channels: DiscordGuildChannel[];
  unavailable: boolean;
  /** When set, member search fails with this HTTP status. */
  searchFailureStatus: number | null;
  restCalls: number;
  cachedMemberReads: number;
  freshMemberReads: number;
};

const state: RestState = {
  guildsOnDiscord: new Set(),
  members: new Map(),
  freshMembers: null,
  channels: [],
  unavailable: false,
  searchFailureStatus: null,
  restCalls: 0,
  cachedMemberReads: 0,
  freshMemberReads: 0,
};

function member(userId: string) {
  return {
    user: { id: userId, username: `user-${userId}` },
    nick: null,
    avatar: null,
    roles: [BOT_ROLE],
  };
}

function guard<T>(produce: () => T): Promise<T> {
  state.restCalls += 1;
  if (state.unavailable) {
    return Promise.reject(
      new DiscordUpstreamError("http_error", "Discord is down", 503),
    );
  }
  return Promise.resolve(produce());
}

const fakeRest: BotRestReader = {
  guild: (guildId) =>
    guard(() =>
      state.guildsOnDiscord.has(guildId)
        ? { id: guildId, name: "test-guild", owner_id: ACTOR }
        : null,
    ),
  guildExists: (guildId) => guard(() => state.guildsOnDiscord.has(guildId)),
  guildChannels: (guildId) =>
    guard(() => (state.guildsOnDiscord.has(guildId) ? state.channels : null)),
  guildRoles: (guildId) =>
    guard(() =>
      state.guildsOnDiscord.has(guildId)
        ? [
            { id: guildId, name: "@everyone", permissions: "0" },
            {
              id: BOT_ROLE,
              name: "Scout",
              permissions: (
                PermissionFlagsBits.ViewChannel |
                PermissionFlagsBits.SendMessages
              ).toString(),
            },
          ]
        : null,
    ),
  botMember: (guildId) =>
    guard(() => (state.guildsOnDiscord.has(guildId) ? member(BOT) : null)),
  guildMember: (guildId, userId) =>
    guard(() => {
      state.cachedMemberReads += 1;
      return state.members.get(guildId)?.has(userId) === true
        ? member(userId)
        : null;
    }),
  // Modelled as a genuinely different source so a test can express "the cache
  // still says present, Discord says gone" — the staleness this read exists to
  // close. Defaults to agreeing with the cached view.
  freshGuildMember: (guildId, userId) =>
    guard(() => {
      state.freshMemberReads += 1;
      const roster = state.freshMembers ?? state.members;
      return roster.get(guildId)?.has(userId) === true ? member(userId) : null;
    }),
  searchGuildMembers: (input) =>
    guard(() => {
      if (state.searchFailureStatus !== null) {
        throw new DiscordUpstreamError(
          "http_error",
          "Missing Access",
          state.searchFailureStatus,
        );
      }
      return [...(state.members.get(input.guildId) ?? [])]
        .filter((id) => id.includes(input.query))
        .slice(0, input.limit)
        .map((id) => member(id));
    }),
  user: (userId) => guard(() => ({ id: userId, username: `user-${userId}` })),
  channel: (channelId) =>
    guard(() => state.channels.find((entry) => entry.id === channelId) ?? null),
  clearCaches: () => {
    /* the fake holds no cache */
  },
};

let membership: PartialGuild[] = [];

vi.doMock("#src/database/index.ts", () => ({ ...databaseModule, prisma }));
// Only the OAuth membership call is stubbed; `callDiscordForRequest` — the
// thing that decides an outage is SERVICE_UNAVAILABLE — stays real.
vi.doMock("#src/trpc/discord-upstream.ts", () => ({
  ...discordUpstreamModule,
  fetchUserGuildsForRequest: () => Promise.resolve(membership),
}));
vi.doMock("#src/lib/discord/bot-rest.ts", async () => {
  const actual = await import("#src/lib/discord/bot-rest.ts");
  return { ...actual, botRest: () => fakeRest };
});
vi.doMock("#src/discord/client.ts", () => ({
  client: {
    isReady: () => false,
    get guilds(): never {
      throw new Error(
        "web-serving code must not read the Discord gateway guild cache",
      );
    },
  },
}));

const { appRouter } = await import("#src/trpc/router/index.ts");
const { discordBotRestFailures } = await import("#src/metrics/platform/web.ts");

/** Total across every `reason` label, so a test can assert "went up by one". */
async function botRestFailureCount(): Promise<number> {
  const metric = await discordBotRestFailures.get();
  return metric.values.reduce(
    (total: number, entry: { value: number }) => total + entry.value,
    0,
  );
}

type TrpcCaller = ReturnType<AppRouter["createCaller"]>;

function user(discordId: string): User {
  return {
    discordId: DiscordAccountIdSchema.parse(discordId),
    discordUsername: "gatewayless",
    discordAvatar: null,
    discordAccessToken: null,
    discordRefreshToken: null,
    tokenExpiresAt: null,
    analyticsUserId: `analytics-${discordId}`,
    lastSeenAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function caller(discordId: string = ACTOR): TrpcCaller {
  return appRouter.createCaller({
    user: user(discordId),
    apiToken: null,
    activitySession: null,
    webSession: {
      discordId,
      csrfToken: "csrf",
      csrfHeader: "csrf",
      origin: configuration.webAppOrigin ?? null,
      ipAddress: "127.0.0.1",
      userAgent: "gatewayless-test",
    },
    clientIp: null,
    requestId: "gatewayless-test",
  });
}

function asMemberOf(guildIds: readonly string[], asAdmin = true): void {
  membership = guildIds.map((id) => ({
    id,
    name: "test-guild",
    icon: null,
    owner: asAdmin,
    permissions: asAdmin ? "8" : "0",
  }));
}

async function seedInstall(
  serverId: typeof INSTALLED,
  removedAt: Date | null = null,
): Promise<void> {
  await prisma.guildInstall.create({
    data: {
      serverId,
      serverName: `Server ${serverId}`,
      ownerDiscordId: ACTOR,
      addedByDiscordId: ACTOR,
      memberCount: 5,
      installedAt: new Date("2026-01-01T00:00:00.000Z"),
      removedAt,
    },
  });
}

async function seedTrackedPlayer(): Promise<void> {
  const now = new Date();
  await prisma.player.create({
    data: {
      alias: TRACKED_ALIAS,
      discordId: ACTOR,
      serverId: INSTALLED,
      creatorDiscordId: ACTOR,
      createdTime: now,
      updatedTime: now,
    },
  });
}

async function seedGrants(
  discordUserId: string,
  permissions: readonly Permission[],
): Promise<void> {
  await prisma.serverPermission.createMany({
    data: permissions.map((permission) => ({
      serverId: INSTALLED,
      discordUserId: DiscordAccountIdSchema.parse(discordUserId),
      permission: permissionKey(permission),
      grantedBy: ACTOR,
      grantedAt: new Date(),
    })),
  });
}

const MANAGER: Permission[] = [
  { resource: "roles", action: "grant" },
  { resource: "roles", action: "revoke" },
];

beforeEach(async () => {
  await prisma.auditLog.deleteMany({});
  await prisma.subscription.deleteMany({});
  await prisma.player.deleteMany({});
  await prisma.serverPermission.deleteMany({});
  await prisma.guildInstall.deleteMany({});
  state.guildsOnDiscord = new Set([INSTALLED, UNROWED]);
  state.members = new Map([
    [INSTALLED, new Set([ACTOR, PEER])],
    [UNROWED, new Set([ACTOR])],
  ]);
  state.freshMembers = null;
  state.channels = [];
  state.unavailable = false;
  state.searchFailureStatus = null;
  state.restCalls = 0;
  state.cachedMemberReads = 0;
  state.freshMemberReads = 0;
  membership = [];
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("guild picker without a gateway", () => {
  test("lists guilds from GuildInstall rows and asks Discord for none of them", async () => {
    await seedInstall(INSTALLED);
    await seedInstall(GONE, new Date("2026-02-01T00:00:00.000Z"));
    asMemberOf([INSTALLED, GONE, UNROWED]);

    const guilds = await caller().guild.listManageable();

    expect(guilds.map((guild) => guild.id)).toEqual([INSTALLED]);
    expect(state.restCalls).toBe(0);
  });
});

describe("single-guild access without a gateway", () => {
  test("a live install row grants access", async () => {
    await seedInstall(INSTALLED);
    asMemberOf([INSTALLED]);
    await expect(
      caller().guild.myPermissions({ guildId: INSTALLED }),
    ).resolves.not.toHaveLength(0);
  });

  test("a missing row is confirmed with Discord rather than refused", async () => {
    asMemberOf([UNROWED]);
    await expect(
      caller().guild.myPermissions({ guildId: UNROWED }),
    ).resolves.not.toHaveLength(0);
  });

  test("Discord overrules a stale live row and answers NOT_FOUND", async () => {
    // Scout was removed while the gateway was down, so no guildDelete ever
    // fired and the row still says installed. Discord's answer wins.
    await seedInstall(INSTALLED);
    state.guildsOnDiscord.delete(INSTALLED);
    asMemberOf([INSTALLED]);
    await expect(
      caller().guild.myPermissions({ guildId: INSTALLED }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("a live row keeps the dashboard up when Discord is unreachable", async () => {
    // The asymmetry, end to end: with a row to fall back on, a Discord blip
    // must not 503 a working dashboard.
    await seedInstall(INSTALLED);
    asMemberOf([INSTALLED]);
    state.unavailable = true;
    await expect(
      caller().guild.myPermissions({ guildId: INSTALLED }),
    ).resolves.not.toHaveLength(0);
  });

  test("a guild Scout is genuinely absent from is NOT_FOUND, as before", async () => {
    asMemberOf([GONE]);
    await expect(
      caller().guild.myPermissions({ guildId: GONE }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("a removed install row is NOT_FOUND once Discord agrees", async () => {
    await seedInstall(GONE, new Date("2026-02-01T00:00:00.000Z"));
    asMemberOf([GONE]);
    await expect(
      caller().guild.myPermissions({ guildId: GONE }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("a non-member is FORBIDDEN before Discord is consulted at all", async () => {
    await seedInstall(INSTALLED);
    asMemberOf([]);
    await expect(
      caller().guild.myPermissions({ guildId: INSTALLED }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.restCalls).toBe(0);
  });

  test("an unreachable Discord is SERVICE_UNAVAILABLE, never NOT_FOUND", async () => {
    asMemberOf([UNROWED]);
    state.unavailable = true;
    await expect(
      caller().guild.myPermissions({ guildId: UNROWED }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});

describe("channel picker without a gateway", () => {
  test("offers the channels the bot can post in", async () => {
    await seedInstall(INSTALLED);
    asMemberOf([INSTALLED]);
    state.channels = [
      {
        id: "1",
        name: "general",
        type: ChannelType.GuildText,
        permission_overwrites: [],
      },
      {
        id: "2",
        name: "stage",
        type: ChannelType.GuildVoice,
        permission_overwrites: [],
      },
    ];

    await expect(
      caller().guild.listChannels({ guildId: INSTALLED }),
    ).resolves.toEqual([{ id: "1", name: "general", parentId: null }]);
  });

  test("an unreachable Discord is SERVICE_UNAVAILABLE", async () => {
    await seedInstall(INSTALLED);
    asMemberOf([INSTALLED]);
    state.unavailable = true;
    await expect(
      caller().guild.listChannels({ guildId: INSTALLED }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  test("does not offer a channel whose overwrite denies Send Messages", async () => {
    await seedInstall(INSTALLED);
    asMemberOf([INSTALLED]);
    state.channels = [postableChannel("1", "general"), mutedChannel()];

    await expect(
      caller().guild.listChannels({ guildId: INSTALLED }),
    ).resolves.toEqual([{ id: "1", name: "general", parentId: null }]);
  });
});

/**
 * The mutation guard must refuse exactly what the picker refuses.
 *
 * It claimed to mirror `listChannels` but checked only the channel's *type*,
 * so a channel the picker had filtered out on permissions was still accepted
 * by every subscription mutation. The subscription was then created
 * successfully and simply never posted — a failure the user discovers by
 * noticing that nothing happens, long after anything points back at the
 * channel they chose.
 */
describe("the channel guard mirrors the picker", () => {
  test("a mutation into a Send-Messages-denied channel is rejected", async () => {
    await seedInstall(INSTALLED);
    asMemberOf([INSTALLED]);
    await seedTrackedPlayer();
    state.channels = [mutedChannel()];

    await expect(
      caller().subscription.addChannel({
        guildId: INSTALLED,
        alias: TRACKED_ALIAS,
        channelId: MUTED_CHANNEL,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Nothing was written on the way to the refusal.
    expect(await prisma.subscription.count()).toBe(0);
  });

  test("the same mutation into a postable channel still succeeds", async () => {
    await seedInstall(INSTALLED);
    asMemberOf([INSTALLED]);
    await seedTrackedPlayer();
    state.channels = [postableChannel(POSTABLE_CHANNEL, "general")];

    await expect(
      caller().subscription.addChannel({
        guildId: INSTALLED,
        alias: TRACKED_ALIAS,
        channelId: POSTABLE_CHANNEL,
      }),
    ).resolves.toMatchObject({ kind: "added" });
    expect(await prisma.subscription.count()).toBe(1);
  });

  test("a channel from another guild is still rejected", async () => {
    await seedInstall(INSTALLED);
    asMemberOf([INSTALLED]);
    await seedTrackedPlayer();
    state.channels = [postableChannel(POSTABLE_CHANNEL, "general")];

    await expect(
      caller().subscription.addChannel({
        guildId: INSTALLED,
        alias: TRACKED_ALIAS,
        channelId: FOREIGN_CHANNEL,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("member-backed role management without a gateway", () => {
  test("member search answers from the REST search endpoint", async () => {
    await seedInstall(INSTALLED);
    asMemberOf([INSTALLED]);
    const results = await caller().discord.searchMembers({
      guildId: INSTALLED,
      query: PEER,
      limit: 5,
    });
    expect(results.map((entry) => entry.id)).toEqual([PEER]);
  });

  test("revoking one of two managers checks the other's membership over REST", async () => {
    await seedInstall(INSTALLED);
    asMemberOf([INSTALLED], false);
    await seedGrants(ACTOR, MANAGER);
    await seedGrants(PEER, MANAGER);

    await expect(
      caller().roles.clear({ guildId: INSTALLED, discordUserId: PEER }),
    ).resolves.toEqual({ ok: true });
    expect(
      await prisma.serverPermission.count({
        where: { serverId: INSTALLED, discordUserId: PEER },
      }),
    ).toBe(0);
  });

  test("a search with no matches is an empty list", async () => {
    await seedInstall(INSTALLED);
    asMemberOf([INSTALLED]);
    await expect(
      caller().discord.searchMembers({
        guildId: INSTALLED,
        query: "nobody-by-that-name",
        limit: 5,
      }),
    ).resolves.toEqual([]);
  });

  test("a 403 on search is SERVICE_UNAVAILABLE, not a blank typeahead", async () => {
    // Blanking the picker would tell the user their teammate is not in the
    // server, sending them to look for a problem that isn't theirs.
    await seedInstall(INSTALLED);
    asMemberOf([INSTALLED]);
    state.searchFailureStatus = 403;
    const before = await botRestFailureCount();

    await expect(
      caller().discord.searchMembers({
        guildId: INSTALLED,
        query: PEER,
        limit: 5,
      }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    // ...and the failure is counted, so a broken install shows up in metrics
    // rather than looking like an unpopular server.
    expect(await botRestFailureCount()).toBe(before + 1);
  });

  test("a manager who left is not counted, even while the cache still has them", async () => {
    // The staleness bug this guards: the cached roster (up to 30s old) still
    // lists ACTOR as a manager, but Discord says they are gone. Counting the
    // cached view would let PEER — the genuinely last manager — be revoked,
    // locking the guild out of its own access management.
    await seedInstall(INSTALLED);
    asMemberOf([INSTALLED], false);
    await seedGrants(ACTOR, MANAGER);
    await seedGrants(PEER, MANAGER);
    state.freshMembers = new Map([[INSTALLED, new Set([PEER])]]);

    await expect(
      caller().roles.clear({ guildId: INSTALLED, discordUserId: PEER }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // The invariant read the uncached source, not the cached one.
    expect(state.freshMemberReads).toBeGreaterThan(0);
    expect(state.cachedMemberReads).toBe(0);
  });

  test("ordinary member reads still use the cached path", async () => {
    // Only the invariant is uncached; nothing else pays a Discord request per
    // lookup. Member search is the ordinary roster surface.
    await seedInstall(INSTALLED);
    asMemberOf([INSTALLED]);
    await caller().discord.searchMembers({
      guildId: INSTALLED,
      query: PEER,
      limit: 5,
    });
    expect(state.freshMemberReads).toBe(0);
  });

  test("the last manager cannot be revoked when the others have left", async () => {
    await seedInstall(INSTALLED);
    asMemberOf([INSTALLED], false);
    await seedGrants(ACTOR, MANAGER);
    await seedGrants(PEER, MANAGER);
    // The acting manager is no longer in the guild, so removing PEER would
    // leave nobody able to restore access.
    state.members.set(INSTALLED, new Set([PEER]));

    await expect(
      caller().roles.clear({ guildId: INSTALLED, discordUserId: PEER }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("an unreachable Discord blocks the revoke as SERVICE_UNAVAILABLE", async () => {
    await seedInstall(INSTALLED);
    asMemberOf([INSTALLED], false);
    await seedGrants(ACTOR, MANAGER);
    await seedGrants(PEER, MANAGER);
    state.unavailable = true;

    await expect(
      caller().roles.clear({ guildId: INSTALLED, discordUserId: PEER }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});
