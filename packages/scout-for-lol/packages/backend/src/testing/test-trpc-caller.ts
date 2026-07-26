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
 *   - `mock.module("#src/trpc/guild-guard.ts", …)` → `assertGuildAdmin` /
 *     `assertChannelInGuild` become no-ops (offline can't verify real Discord
 *     membership; that check is out of scope for these tests).
 *   - `mock.module("#src/database/index.ts", …)` → the router's `prisma` points
 *     at an isolated, migrated test DB (a copy of `template.db`). The real
 *     module is spread so its other exports stay intact for the rest of the
 *     router graph.
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

import { mock } from "bun:test";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import type { User } from "#generated/prisma/client/index.js";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
// Type-only import — erased at runtime, so it does NOT load the router before
// the mocks are installed.
import type { AppRouter } from "#src/trpc/router/index.ts";
import type { PartialGuild } from "#src/lib/discord-rest.ts";
import * as databaseModule from "#src/database/index.ts";
import * as discordRestModule from "#src/lib/discord-rest.ts";
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

class UnknownMemberError extends Error {
  readonly code = 10_007;
}

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

  void mock.module("#src/trpc/guild-guard.ts", () => ({
    assertGuildAdmin: () => Promise.resolve(),
    assertChannelInGuild: () => {
      /* no-op: real bot-cache membership check is out of scope offline */
    },
  }));
  void mock.module("#src/database/index.ts", () => ({
    ...databaseModule,
    prisma,
  }));
  // The RBAC guard resolves membership/admin via fetchUserGuilds + the bot's
  // guild cache. Stub those two seams so the REAL resolveGuildPermissions runs
  // against seeded ServerPermission rows.
  void mock.module("#src/lib/discord-rest.ts", () => ({
    ...discordRestModule,
    fetchUserGuilds: () => Promise.resolve(toPartialGuilds()),
  }));
  void mock.module("#src/discord/client.ts", () => ({
    client: {
      guilds: {
        cache: {
          has: (id: string) =>
            state.membership === "root" || installedGuildIds().has(id),
          get: (id: string) => {
            if (state.membership !== "root" && !installedGuildIds().has(id)) {
              return;
            }
            return {
              members: {
                fetch: (options: { user?: string; query?: string }) => {
                  if (options.query !== undefined) {
                    return Promise.resolve({ map: () => [] });
                  }
                  if (
                    options.user !== undefined &&
                    state.guildMembers.get(id)?.has(options.user) === true
                  ) {
                    return Promise.resolve({ id: options.user });
                  }
                  return Promise.reject(
                    new UnknownMemberError("Unknown Member"),
                  );
                },
              },
            };
          },
          map: <T>(fn: (g: { id: string }) => T): T[] =>
            [...installedGuildIds()].map((id) => fn({ id })),
        },
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
      webSession: {
        discordId,
        csrfToken: "csrf",
        csrfHeader: "csrf",
        // Same-origin check only fires when webAppOrigin is configured.
        origin: configuration.webAppOrigin ?? null,
        ipAddress: "127.0.0.1",
        userAgent: "offline-trpc-harness",
      },
      requestId: "offline-trpc-harness",
    });

  const anonCaller = () =>
    appRouter.createCaller({
      user: null,
      apiToken: null,
      webSession: null,
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
