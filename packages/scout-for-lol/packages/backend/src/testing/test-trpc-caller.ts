/**
 * Offline tRPC test harness — exercise the web API WITHOUT Discord OAuth or any
 * real Discord backing.
 *
 * The web procedures (`webProcedure` / `webMutationProcedure`) normally require a
 * signed `scout_session` cookie + a DB user + CSRF + a real `assertGuildAdmin`
 * (which calls Discord). `appRouter.createCaller(ctx)` skips the HTTP/cookie
 * layer entirely — you hand it a `Context` object directly — so the only things
 * left to neutralize are the guild guard (real Discord call) and the global
 * Prisma singleton (bound to `DATABASE_URL` at import). This harness does both:
 *
 *   - `vi.doMock("#src/trpc/guild-guard.ts", …)` → `assertGuildAdmin` /
 *     `assertChannelInGuild` become no-ops (offline can't verify real Discord
 *     membership; that check is out of scope for these tests).
 *   - `vi.doMock("#src/database/index.ts", …)` → the router's `prisma` points
 *     at an isolated, migrated test DB (a copy of `template.db`). The real
 *     module is spread so its other exports stay intact for the rest of the
 *     router graph.
 *   - `vi.doMock("#src/lib/discord/installed-guilds.ts", …)` and
 *     `vi.doMock("#src/lib/discord/bot-rest.ts", …)` → the two application
 *     ports the web request path reads Discord through. These replaced a mock
 *     of the gateway client's `guilds.cache`, which is no longer consulted by
 *     any web-serving code.
 *
 * Because it mutates the module registry, call this at the TOP of a test file,
 * before anything imports `appRouter`, and take `appRouter` from the returned
 * object rather than importing it directly.
 *
 * Usage:
 * ```ts
 * import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";
 *
 * const trpc = await createOfflineTrpcHarness("my-feature-test");
 * const caller = trpc.authedCaller(); // authenticated web session, guard stubbed
 * await caller.subscription.setFilters({ guildId, channelId, alias, filters });
 * // assert against trpc.prisma …
 * // trpc.anonCaller() builds an UNauthenticated caller for rejection tests.
 * // remember: await trpc.prisma.$disconnect() in afterAll.
 * ```
 */

import { vi } from "vitest";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import type { User } from "#generated/prisma/client/index.js";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
// Type-only import — erased at runtime, so it does NOT load the router before
// the mocks are installed.
import type { AppRouter } from "#src/trpc/router/index.ts";
import type { PartialGuild } from "#src/lib/discord-rest.ts";
import * as databaseModule from "#src/database/index.ts";
import * as discordUpstreamModule from "#src/trpc/discord-upstream.ts";
import configuration from "#src/configuration.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testAccountId } from "#src/testing/test-ids.ts";

type TrpcCaller = ReturnType<AppRouter["createCaller"]>;

/**
 * Controls what the RBAC guard (`resolveGuildPermissions`) sees for Discord
 * membership/admin. Default: the actor is an admin/owner of every guild (root),
 * so tests that don't care about RBAC keep full access. Downgrade to a plain
 * member with `setMembership` and seed `ServerPermission` rows to drive
 * per-permission gating.
 */
type MembershipConfig = "root" | { guildId: string; asAdmin: boolean }[];

// test-ids requires a digits-only identifier (it builds a snowflake).
const DEFAULT_ACTOR = testAccountId("900000001");

function makeUser(discordId: string, overrides?: Partial<User>): User {
  return {
    discordId: DiscordAccountIdSchema.parse(discordId),
    discordUsername: "trpc-harness",
    discordAvatar: null,
    discordAccessToken: null,
    discordRefreshToken: null,
    tokenExpiresAt: null,
    analyticsUserId: `analytics-${discordId}`,
    lastSeenAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export type OfflineTrpcHarness = {
  /** The isolated, migrated test DB the router writes to. Disconnect in afterAll. */
  prisma: ExtendedPrismaClient;
  /** Filesystem path of the test DB (handy for debugging). */
  dbPath: string;
  /** The router, imported AFTER the mocks are installed. */
  appRouter: AppRouter;
  /**
   * A caller with a valid authenticated web session (CSRF matched, origin set
   * to the configured `webAppOrigin`, guild guard stubbed). Pass a discordId to
   * act as a specific user; defaults to a stable harness actor.
   */
  authedCaller: (
    discordId?: string,
    userOverrides?: Partial<User>,
  ) => TrpcCaller;
  /** A caller with no session — use to assert unauthenticated rejection. */
  anonCaller: () => TrpcCaller;
  /**
   * Set what the RBAC guard sees. `"root"` (default) makes the actor a Discord
   * admin/owner of every guild; an explicit list makes them a member (admin or
   * not) of only those guilds, so seeded grants decide access.
   */
  setMembership: (config: MembershipConfig) => void;
  /** Set the current Discord member IDs returned by guild member fetches. */
  setGuildMembers: (guildId: string, discordIds: readonly string[]) => void;
};

// An array whose `.find()` always yields an admin guild, so the actor is
// treated as admin/owner of whatever guildId the middleware looks up (root mode).
function rootMembership(): PartialGuild[] {
  const adminGuild: PartialGuild = {
    id: "root",
    name: "test-guild",
    icon: null,
    owner: true,
    permissions: "8",
  };
  const guilds: PartialGuild[] = [adminGuild];
  Object.defineProperty(guilds, "find", {
    value: () => adminGuild,
    configurable: true,
  });
  return guilds;
}

/**
 * Build an offline tRPC harness backed by an isolated test DB, with the Discord
 * guild guard stubbed out. See the module docblock for the constraints.
 */
export async function createOfflineTrpcHarness(
  testName: string,
): Promise<OfflineTrpcHarness> {
  const { prisma, dbPath } = createTestDatabase(testName);

  // Membership/admin state the RBAC guard reads (mutable via setMembership).
  const state: {
    membership: MembershipConfig;
    guildMembers: Map<string, Set<string>>;
  } = { membership: "root", guildMembers: new Map() };
  const toPartialGuilds = (): PartialGuild[] =>
    state.membership === "root"
      ? rootMembership()
      : state.membership.map((m) => ({
          id: m.guildId,
          name: "test-guild",
          icon: null,
          owner: m.asAdmin,
          permissions: m.asAdmin ? "8" : "0",
        }));
  const installedGuildIds = (): Set<string> =>
    state.membership === "root"
      ? new Set()
      : new Set(state.membership.map((m) => m.guildId));

  vi.doMock("#src/trpc/guild-guard.ts", () => ({
    assertGuildAdmin: () => Promise.resolve(),
    assertChannelInGuild: () => {
      /* no-op: real bot-cache membership check is out of scope offline */
    },
  }));
  vi.doMock("#src/database/index.ts", () => ({
    ...databaseModule,
    prisma,
  }));
  // The RBAC guard resolves membership/admin via fetchUserGuildsForRequest +
  // the bot's guild cache. Stub those two seams so the REAL
  // resolveGuildPermissions runs against seeded ServerPermission rows.
  //
  // Stub the request-layer seam, NOT `#src/lib/discord-rest.ts`: `vi.doMock`
  // is process-global in Bun, so mocking the lower module would also replace
  // `fetchUserGuilds` for its own unit tests (`src/lib/discord-rest.test.ts`)
  // whenever they run in the same test worker.
  vi.doMock("#src/trpc/discord-upstream.ts", () => ({
    ...discordUpstreamModule,
    fetchUserGuildsForRequest: () => Promise.resolve(toPartialGuilds()),
  }));
  // "Is Scout installed here?" — root mode says yes for every guild the guard
  // asks about, matching the old cache stub. The bulk (guild-picker) form
  // returns only explicitly-listed guilds, because root mode has no guild list.
  vi.doMock("#src/lib/discord/installed-guilds.ts", () => ({
    isScoutInstalledInGuild: (guildId: string) =>
      Promise.resolve(
        state.membership === "root" || installedGuildIds().has(guildId),
      ),
    installedGuildIdsAmong: (guildIds: readonly string[]) =>
      Promise.resolve(
        new Set(guildIds.filter((id) => installedGuildIds().has(id))),
      ),
    installedGuildName: () => Promise.resolve(null),
  }));
  // The bot-token REST reads. Membership is driven by `setGuildMembers`;
  // everything else answers "Scout is not in that guild" so a test that
  // accidentally depends on a real Discord read fails visibly rather than
  // hanging on the network.
  vi.doMock("#src/lib/discord/bot-rest.ts", () => ({
    botRest: () => ({
      guildExists: (guildId: string) =>
        Promise.resolve(
          state.membership === "root" || installedGuildIds().has(guildId),
        ),
      guildChannels: () => Promise.resolve(null),
      guildRoles: () => Promise.resolve(null),
      botMember: () => Promise.resolve(null),
      // The offline harness has no cache, so the fresh read is the same stub.
      freshGuildMember: (guildId: string, userId: string) =>
        Promise.resolve(
          state.guildMembers.get(guildId)?.has(userId) === true
            ? {
                user: { id: userId, username: userId },
                nick: null,
                avatar: null,
                roles: [],
              }
            : null,
        ),
      guildMember: (guildId: string, userId: string) =>
        Promise.resolve(
          state.guildMembers.get(guildId)?.has(userId) === true
            ? {
                user: { id: userId, username: userId },
                nick: null,
                avatar: null,
                roles: [],
              }
            : null,
        ),
      searchGuildMembers: () => Promise.resolve([]),
      user: () => Promise.resolve(null),
      channel: () => Promise.resolve(null),
      clearCaches: () => {
        /* no cache in the offline stub */
      },
    }),
    memberDisplayName: (member: { user: { username: string } }) =>
      member.user.username,
    memberAvatarUrl: () => "",
    userAvatarUrl: () => "",
  }));
  vi.doMock("#src/discord/client.ts", () => ({
    client: {
      isReady: () => false,
      // No web-serving code reads the gateway cache any more; anything that
      // reaches for the client offline should fail loudly, not read a stub.
      guilds: {
        fetch: () =>
          Promise.reject(new Error("offline harness: no Discord gateway")),
      },
    },
  }));

  const { appRouter } = await import("#src/trpc/router/index.ts");

  const authedCaller = (
    discordId: string = DEFAULT_ACTOR,
    userOverrides?: Partial<User>,
  ) =>
    appRouter.createCaller({
      user: makeUser(discordId, userOverrides),
      apiToken: null,
      activitySession: null,
      webSession: {
        discordId,
        csrfToken: "csrf",
        csrfHeader: "csrf",
        // Same-origin check only fires when webAppOrigin is configured.
        origin: configuration.webAppOrigin ?? null,
        ipAddress: "127.0.0.1",
        userAgent: "offline-trpc-harness",
      },
      clientIp: null,
      requestId: "offline-trpc-harness",
    });

  const anonCaller = () =>
    appRouter.createCaller({
      user: null,
      apiToken: null,
      activitySession: null,
      webSession: null,
      clientIp: null,
      requestId: "offline-trpc-harness-anon",
    });

  const setMembership = (config: MembershipConfig) => {
    state.membership = config;
  };
  const setGuildMembers = (guildId: string, discordIds: readonly string[]) => {
    state.guildMembers.set(guildId, new Set(discordIds));
  };

  return {
    prisma,
    dbPath,
    appRouter,
    authedCaller,
    anonCaller,
    setMembership,
    setGuildMembers,
  };
}
