import { describe, expect, test } from "vitest";
import { DiscordUpstreamError } from "#src/lib/discord-rest.ts";
import {
  MEMBERSHIP_TTL_MS,
  PERMISSION_TTL_MS,
  createBotRestReader,
  memberAvatarUrl,
  memberDisplayName,
  userAvatarUrl,
  type BotRestGet,
} from "#src/lib/discord/bot-rest.ts";

const GUILD = "100";
const BOT = "999";
const USER = "200";

/** Shaped like discord.js `DiscordAPIError`: a Discord code plus HTTP status. */
class ApiError extends Error {
  readonly code: number;
  readonly status: number;
  constructor(code: number, status: number) {
    super(`Discord error ${code.toString()}`);
    this.code = code;
    this.status = status;
  }
}

/** Shaped like discord.js `HTTPError`: a status with no Discord code. */
class HttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`HTTP ${status.toString()}`);
    this.status = status;
  }
}

function recorder(handler: BotRestGet) {
  const routes: string[] = [];
  const queries: (string | undefined)[] = [];
  const get: BotRestGet = async (route, options) => {
    routes.push(route);
    queries.push(options?.query?.toString());
    return await handler(route, options);
  };
  return { get, routes, queries };
}

function clockAtZero(): { value: number } {
  return { value: 0 };
}

function reader(handler: BotRestGet, clock: { value: number } = clockAtZero()) {
  const recorded = recorder(handler);
  return {
    ...recorded,
    clock,
    rest: createBotRestReader({
      get: recorded.get,
      now: () => clock.value,
      botUserId: BOT,
    }),
  };
}

const ROLES = [{ id: GUILD, name: "@everyone", permissions: "1024" }];

describe("createBotRestReader caching", () => {
  test("collapses repeated reads within the TTL and refetches after it", async () => {
    const clock = { value: 0 };
    const harness = reader(() => Promise.resolve(ROLES), clock);

    await harness.rest.guildRoles(GUILD);
    await harness.rest.guildRoles(GUILD);
    expect(harness.routes).toHaveLength(1);

    clock.value += PERMISSION_TTL_MS - 1;
    await harness.rest.guildRoles(GUILD);
    expect(harness.routes).toHaveLength(1);

    clock.value += 2;
    await harness.rest.guildRoles(GUILD);
    expect(harness.routes).toHaveLength(2);
  });

  test("member lookups expire on the shorter membership TTL", async () => {
    const clock = { value: 0 };
    const member = { user: { id: USER, username: "someone" }, roles: [] };
    const harness = reader(() => Promise.resolve(member), clock);

    await harness.rest.guildMember(GUILD, USER);
    clock.value += MEMBERSHIP_TTL_MS + 1;
    await harness.rest.guildMember(GUILD, USER);
    expect(harness.routes).toHaveLength(2);
    // Still inside the *permission* TTL, proving the caches are independent.
    expect(MEMBERSHIP_TTL_MS).toBeLessThan(PERMISSION_TTL_MS);
  });

  test("caches per guild, not globally", async () => {
    const harness = reader(() => Promise.resolve(ROLES));
    await harness.rest.guildRoles(GUILD);
    await harness.rest.guildRoles("101");
    expect(harness.routes).toEqual(["/guilds/100/roles", "/guilds/101/roles"]);
  });

  test("failures are not cached", async () => {
    let calls = 0;
    const harness = reader(() => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new HttpError(500))
        : Promise.resolve(ROLES);
    });
    await expect(harness.rest.guildRoles(GUILD)).rejects.toBeInstanceOf(
      DiscordUpstreamError,
    );
    await expect(harness.rest.guildRoles(GUILD)).resolves.toEqual(ROLES);
  });
});

describe("createBotRestReader absence vs unavailability", () => {
  test("Unknown Guild is an answer, not a failure", async () => {
    const harness = reader(() => Promise.reject(new ApiError(10_004, 404)));
    await expect(harness.rest.guildExists(GUILD)).resolves.toBe(false);
    await expect(harness.rest.guildChannels(GUILD)).resolves.toBeNull();
    await expect(harness.rest.guildRoles(GUILD)).resolves.toBeNull();
    await expect(harness.rest.botMember(GUILD)).resolves.toBeNull();
    await expect(
      harness.rest.searchGuildMembers({ guildId: GUILD, query: "a", limit: 5 }),
    ).resolves.toEqual([]);
  });

  test("Unknown Member is an answer, not a failure", async () => {
    const harness = reader(() => Promise.reject(new ApiError(10_007, 404)));
    await expect(harness.rest.guildMember(GUILD, USER)).resolves.toBeNull();
  });

  test("an HTTP failure raises an upstream error, never a false absence", async () => {
    const harness = reader(() => Promise.reject(new HttpError(503)));
    const pending = harness.rest.guildExists(GUILD);
    await expect(pending).rejects.toBeInstanceOf(DiscordUpstreamError);
    await expect(pending).rejects.toMatchObject({
      reason: "http_error",
      status: 503,
    });
  });

  test("a rate-limited read is upstream failure, not absence", async () => {
    // Code 0 with status 429: a real Discord error code that is emphatically
    // not "this guild does not exist".
    const harness = reader(() => Promise.reject(new ApiError(0, 429)));
    await expect(harness.rest.guildExists(GUILD)).rejects.toMatchObject({
      reason: "http_error",
      status: 429,
    });
  });

  test("a transport failure with no status reports fetch_error", async () => {
    const harness = reader(() => Promise.reject(new Error("socket hang up")));
    await expect(harness.rest.guildRoles(GUILD)).rejects.toMatchObject({
      reason: "fetch_error",
    });
  });

  test("an unexpected payload shape reports schema_error", async () => {
    const harness = reader(() => Promise.resolve({ unexpected: true }));
    await expect(harness.rest.guildRoles(GUILD)).rejects.toMatchObject({
      reason: "schema_error",
    });
  });
});

describe("createBotRestReader routes", () => {
  test("reads the bot's own member row by application id", async () => {
    const harness = reader(() =>
      Promise.resolve({ user: { id: BOT, username: "scout" }, roles: [] }),
    );
    await harness.rest.botMember(GUILD);
    expect(harness.routes).toEqual(["/guilds/100/members/999"]);
  });

  test("a single channel is read by id and not cached", async () => {
    const harness = reader(() =>
      Promise.resolve({
        id: "5",
        name: "lobby",
        type: 2,
        guild_id: GUILD,
      }),
    );
    await harness.rest.channel("5");
    await harness.rest.channel("5");
    expect(harness.routes).toEqual(["/channels/5", "/channels/5"]);
  });

  test("an unknown channel is an answer, not a failure", async () => {
    const harness = reader(() => Promise.reject(new ApiError(10_003, 404)));
    await expect(harness.rest.channel("5")).resolves.toBeNull();
  });

  test("member search uses the REST search endpoint and is not cached", async () => {
    const harness = reader(() => Promise.resolve([]));
    await harness.rest.searchGuildMembers({
      guildId: GUILD,
      query: "ali",
      limit: 7,
    });
    await harness.rest.searchGuildMembers({
      guildId: GUILD,
      query: "ali",
      limit: 7,
    });
    expect(harness.routes).toEqual([
      "/guilds/100/members/search",
      "/guilds/100/members/search",
    ]);
    expect(harness.queries[0]).toBe("query=ali&limit=7");
  });
});

describe("display helpers", () => {
  test("prefers the guild nickname, then the global name, then the username", () => {
    const user = { id: USER, username: "plain", global_name: "Global" };
    expect(memberDisplayName({ user, nick: "Nick", roles: [] })).toBe("Nick");
    expect(memberDisplayName({ user, roles: [] })).toBe("Global");
    expect(
      memberDisplayName({ user: { id: USER, username: "plain" }, roles: [] }),
    ).toBe("plain");
  });

  test("prefers a per-guild avatar over the account avatar", () => {
    const member = {
      user: { id: USER, username: "plain", avatar: "useravatar" },
      avatar: "guildavatar",
      roles: [],
    };
    expect(memberAvatarUrl(member, GUILD)).toContain(
      "/guilds/100/users/200/avatars/guildavatar",
    );
    expect(memberAvatarUrl({ ...member, avatar: null }, GUILD)).toContain(
      "/avatars/200/useravatar",
    );
  });

  test("falls back to the default avatar for accounts with none", () => {
    expect(userAvatarUrl({ id: "1234567890123456789", username: "a" })).toBe(
      "https://cdn.discordapp.com/embed/avatars/1.png",
    );
    // A legacy discriminator indexes into five avatars instead of six.
    expect(
      userAvatarUrl({
        id: "1234567890123456789",
        username: "a",
        discriminator: "0007",
      }),
    ).toBe("https://cdn.discordapp.com/embed/avatars/2.png");
  });
});
