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
import * as databaseModule from "#src/database/index.ts";
import configuration from "#src/configuration.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testAccountId } from "#src/testing/test-ids.ts";

type TrpcCaller = ReturnType<AppRouter["createCaller"]>;

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
};

/**
 * Build an offline tRPC harness backed by an isolated test DB, with the Discord
 * guild guard stubbed out. See the module docblock for the constraints.
 */
export async function createOfflineTrpcHarness(
  testName: string,
): Promise<OfflineTrpcHarness> {
  const { prisma, dbPath } = createTestDatabase(testName);

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

  return { prisma, dbPath, appRouter, authedCaller, anonCaller };
}
