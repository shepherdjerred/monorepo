/**
 * Failure semantics of the Discord REST helpers.
 *
 * The invariant under test: `fetchUserGuilds` returns `[]` ONLY when Discord
 * authoritatively said "no guilds". Every other outcome throws
 * `DiscordUpstreamError`. Before this, all five failure paths returned `[]`,
 * which the permission layer read as "not a member" and reported to the user as
 * "You are not a member of that guild" during a plain Discord outage.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import type { User } from "#generated/prisma/client/index.js";
import {
  DiscordUpstreamError,
  devGuildOverride,
  fetchUserGuilds,
  hasAdministrator,
} from "#src/lib/discord-rest.ts";
import { testAccountId } from "#src/testing/test-ids.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

let userSeq = 0;
/** A distinct user per test — the guild list is cached per discordId. */
function testUser(overrides: Partial<User> = {}): User {
  userSeq += 1;
  return {
    discordId: testAccountId(userSeq.toString()),
    discordUsername: "tester",
    discordAvatar: null,
    discordAccessToken: "valid-access-token",
    discordRefreshToken: "refresh-token",
    // Far future, so no refresh is attempted unless a test asks for one.
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    analyticsUserId: `analytics-${userSeq.toString()}`,
    lastSeenAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Swap in a fetch-shaped stub, preserving the `preconnect` member. */
function installFetch(implementation: () => Promise<Response>): void {
  globalThis.fetch = Object.assign(vi.fn(implementation), {
    preconnect: realFetch.preconnect,
  });
}

function respondWith(body: string, init: ResponseInit = {}): void {
  installFetch(() => Promise.resolve(new Response(body, init)));
}

/** Resolve to whatever `promise` rejected with, or null if it resolved. */
async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

describe("fetchUserGuilds", () => {
  it("returns the parsed list when Discord answers", async () => {
    respondWith(
      JSON.stringify([
        { id: "1", name: "G", icon: null, owner: true, permissions: "8" },
      ]),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

    const guilds = await fetchUserGuilds(testUser());
    expect(guilds).toHaveLength(1);
    expect(guilds[0]?.id).toBe("1");
  });

  it("returns [] for a genuine empty membership list", async () => {
    respondWith("[]", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    // This is the ONE case where [] is a real answer, so it must not throw.
    expect(await fetchUserGuilds(testUser())).toEqual([]);
  });

  it("throws fetch_error when the request fails outright", async () => {
    installFetch(() => Promise.reject(new Error("ECONNRESET")));

    const error = await captureError(fetchUserGuilds(testUser()));
    expect(error).toBeInstanceOf(DiscordUpstreamError);
    expect(error).toMatchObject({ reason: "fetch_error" });
  });

  it("throws http_error for a Discord 5xx", async () => {
    respondWith("upstream boom", { status: 503 });

    const error = await captureError(fetchUserGuilds(testUser()));
    expect(error).toBeInstanceOf(DiscordUpstreamError);
    expect(error).toMatchObject({ reason: "http_error", status: 503 });
  });

  it("throws http_error when Discord rate-limits us", async () => {
    respondWith("rate limited", { status: 429 });

    // A 429 is our problem, not a sign the user lost access — it must not be
    // reported as an authentication failure.
    const error = await captureError(fetchUserGuilds(testUser()));
    expect(error).toMatchObject({ reason: "http_error", status: 429 });
  });

  it("throws token_refresh_failed when Discord rejects the access token", async () => {
    respondWith("unauthorized", { status: 401 });

    const error = await captureError(fetchUserGuilds(testUser()));
    expect(error).toMatchObject({ reason: "token_refresh_failed" });
  });

  it("throws parse_error on malformed JSON", async () => {
    respondWith("not json at all", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    const error = await captureError(fetchUserGuilds(testUser()));
    expect(error).toMatchObject({ reason: "parse_error" });
  });

  it("throws schema_error when the payload shape is unexpected", async () => {
    respondWith(JSON.stringify([{ id: 1234, unexpected: true }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    const error = await captureError(fetchUserGuilds(testUser()));
    expect(error).toMatchObject({ reason: "schema_error" });
  });

  it("throws token_refresh_failed when there is no refresh token to use", async () => {
    installFetch(() => {
      throw new Error("fetch must not be attempted without a token");
    });

    const error = await captureError(
      fetchUserGuilds(
        testUser({
          discordAccessToken: null,
          discordRefreshToken: null,
          tokenExpiresAt: new Date(Date.now() - 1000),
        }),
      ),
    );
    expect(error).toMatchObject({ reason: "token_refresh_failed" });
  });
});

/**
 * The dev-only membership stand-in.
 *
 * Every condition is tested for *refusing* as well as accepting, because each
 * one is what stops this reaching a deployed environment: `ENVIRONMENT`
 * defaults to "dev" when unset, so the environment check alone fails open.
 */
describe("devGuildOverride", () => {
  const guildIds = ["1337623164146155593"];

  it("stands in for Discord when dev, dev-login, and ids all line up", () => {
    const guilds = devGuildOverride({
      environment: "dev",
      enableDevLogin: true,
      guildIds,
    });
    expect(guilds).toEqual([
      {
        id: "1337623164146155593",
        name: "Dev Guild 1",
        icon: null,
        owner: true,
        permissions: "8",
      },
    ]);
  });

  it("grants administrator so management screens are reachable", () => {
    const guilds = devGuildOverride({
      environment: "dev",
      enableDevLogin: true,
      guildIds,
    });
    expect(hasAdministrator(guilds?.[0]?.permissions ?? "0")).toBe(true);
  });

  it("refuses outside dev even with dev-login on", () => {
    for (const environment of ["beta", "prod"]) {
      expect(
        devGuildOverride({ environment, enableDevLogin: true, guildIds }),
      ).toBeNull();
    }
  });

  it("refuses in dev without the explicit dev-login flag", () => {
    expect(
      devGuildOverride({
        environment: "dev",
        enableDevLogin: false,
        guildIds,
      }),
    ).toBeNull();
  });

  it("treats an empty or blank list as no override, not as no guilds", () => {
    for (const ids of [[], [""], ["  "]]) {
      expect(
        devGuildOverride({
          environment: "dev",
          enableDevLogin: true,
          guildIds: ids,
        }),
      ).toBeNull();
    }
  });

  it("ignores surrounding whitespace from a comma-separated env var", () => {
    const guilds = devGuildOverride({
      environment: "dev",
      enableDevLogin: true,
      guildIds: [" 111 ", "", "222"],
    });
    expect(guilds?.map((guild) => guild.id)).toEqual(["111", "222"]);
  });
});
