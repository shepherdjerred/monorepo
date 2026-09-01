import { afterEach, describe, expect, test } from "vitest";
import { resetConfigurationForTests } from "#src/configuration.ts";
import { listGuildsWithFlagEnabled } from "#src/configuration/flags.ts";
import { guildCommandPayload } from "#src/discord/commands/definitions.ts";
import {
  reconcileGuildScopedCommands,
  registerDiscordCommands,
  resetGuildCommandWriteCacheForTests,
  type DiscordCommandPut,
} from "#src/discord/rest.ts";

const originalAllowlist = Bun.env["EXPLORE_GUILD_ALLOWLIST"];
const originalEnvironment = Bun.env["ENVIRONMENT"];

afterEach(() => {
  resetGuildCommandWriteCacheForTests();
  if (originalAllowlist === undefined) {
    delete Bun.env["EXPLORE_GUILD_ALLOWLIST"];
  } else {
    Bun.env["EXPLORE_GUILD_ALLOWLIST"] = originalAllowlist;
  }
  if (originalEnvironment === undefined) {
    delete Bun.env["ENVIRONMENT"];
  } else {
    Bun.env["ENVIRONMENT"] = originalEnvironment;
  }
  resetConfigurationForTests();
});

function bettingGuild(): string {
  const guildId = listGuildsWithFlagEnabled("betting_enabled")[0];
  if (guildId === undefined) {
    throw new Error("Tests require one betting-enabled guild fixture.");
  }
  return guildId;
}

const missingAccessPut: DiscordCommandPut = () =>
  Promise.reject(Object.assign(new Error("Missing access"), { code: 50_001 }));

describe("Discord command reconciliation", () => {
  test("merges every enabled guild-scoped group into one replacement payload", async () => {
    // A guild PUT replaces that guild's whole command list for the app, so the
    // groups have to be merged before sending or the last one would win.
    Bun.env["ENVIRONMENT"] = "beta";
    resetConfigurationForTests();
    const guildId = bettingGuild();
    Bun.env["EXPLORE_GUILD_ALLOWLIST"] = guildId;
    resetConfigurationForTests();

    const payload = await guildCommandPayload(guildId);
    expect(payload.map((command) => command.name)).toEqual([
      "bb",
      "scout",
      "lobby",
    ]);
  });

  test("sends empty payloads to clear stale guild commands", async () => {
    Bun.env["ENVIRONMENT"] = "beta";
    Bun.env["EXPLORE_GUILD_ALLOWLIST"] = "";
    resetConfigurationForTests();
    const calls: { route: string; names: string[] }[] = [];
    const put: DiscordCommandPut = (route, body) => {
      calls.push({ route, names: body.map((command) => command.name) });
      return Promise.resolve(undefined);
    };

    await reconcileGuildScopedCommands(["100000000000000099"], put);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.route).toContain("/guilds/100000000000000099/");
    expect(calls[0]?.names).toEqual([]);
  });

  test("reconciles globals and the complete connected-guild set after ready", async () => {
    Bun.env["ENVIRONMENT"] = "prod";
    resetConfigurationForTests();
    const calls: { route: string; names: string[] }[] = [];
    const put: DiscordCommandPut = (route, body) => {
      calls.push({ route, names: body.map((command) => command.name) });
      return Promise.resolve(undefined);
    };

    await registerDiscordCommands(["100000000000000097"], put);

    expect(calls[0]?.names).toEqual([
      "help",
      "setup",
      "status",
      "invite",
      "docs",
      "track",
      "list",
      "scout",
    ]);
    expect(calls[1]?.route).toContain("/guilds/100000000000000097/");
    expect(calls[1]?.names).toEqual([]);
  });

  test("reconciles a newly joined guild immediately", async () => {
    Bun.env["ENVIRONMENT"] = "beta";
    Bun.env["EXPLORE_GUILD_ALLOWLIST"] = "100000000000000096";
    resetConfigurationForTests();
    const payloads: string[][] = [];
    const put: DiscordCommandPut = (_route, body) => {
      payloads.push(body.map((command) => command.name));
      return Promise.resolve(undefined);
    };

    await reconcileGuildScopedCommands(["100000000000000096"], put);
    expect(payloads).toEqual([["scout"]]);
  });

  test("tolerates a guild configured for the other Discord application", async () => {
    await expect(
      reconcileGuildScopedCommands(["100000000000000095"], missingAccessPut),
    ).resolves.toBeUndefined();
  });

  test("skips the write when the guild payload has not changed", async () => {
    // The dynamic-config poll calls this every 60 seconds and the payload
    // almost never differs, so an unconditional PUT was 1,440 no-op
    // bulk-overwrites a day — and 1,440 log lines that hid the one real one.
    Bun.env["ENVIRONMENT"] = "beta";
    Bun.env["EXPLORE_GUILD_ALLOWLIST"] = "100000000000000094";
    resetConfigurationForTests();
    const payloads: string[][] = [];
    const put: DiscordCommandPut = (_route, body) => {
      payloads.push(body.map((command) => command.name));
      return Promise.resolve(undefined);
    };

    await reconcileGuildScopedCommands(["100000000000000094"], put);
    await reconcileGuildScopedCommands(["100000000000000094"], put);
    await reconcileGuildScopedCommands(["100000000000000094"], put);

    expect(payloads).toEqual([["scout"]]);
  });

  test("writes again as soon as the payload actually changes", async () => {
    Bun.env["ENVIRONMENT"] = "beta";
    Bun.env["EXPLORE_GUILD_ALLOWLIST"] = "100000000000000093";
    resetConfigurationForTests();
    const payloads: string[][] = [];
    const put: DiscordCommandPut = (_route, body) => {
      payloads.push(body.map((command) => command.name));
      return Promise.resolve(undefined);
    };

    await reconcileGuildScopedCommands(["100000000000000093"], put);
    await reconcileGuildScopedCommands(["100000000000000093"], put);

    // An operator removing the guild from the allowlist must still clear its
    // commands on the very next poll.
    Bun.env["EXPLORE_GUILD_ALLOWLIST"] = "";
    resetConfigurationForTests();
    await reconcileGuildScopedCommands(["100000000000000093"], put);

    expect(payloads).toEqual([["scout"], []]);
  });

  test("does not cache a payload whose write failed", async () => {
    // Caching an unsent payload would strand the guild until the pod restarts.
    Bun.env["ENVIRONMENT"] = "beta";
    Bun.env["EXPLORE_GUILD_ALLOWLIST"] = "100000000000000092";
    resetConfigurationForTests();
    let attempts = 0;
    const failThenSucceed: DiscordCommandPut = () => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error("Discord is down"))
        : Promise.resolve(undefined);
    };

    await expect(
      reconcileGuildScopedCommands(["100000000000000092"], failThenSucceed),
    ).rejects.toThrow("Failed to reconcile guild-scoped commands");
    await reconcileGuildScopedCommands(["100000000000000092"], failThenSucceed);

    expect(attempts).toBe(2);
  });

  test("a forced reconcile writes even when nothing changed", async () => {
    // Startup and `guildCreate` cannot know what Discord currently holds — a
    // rejoined guild has had its commands dropped while the entry survives.
    Bun.env["ENVIRONMENT"] = "beta";
    Bun.env["EXPLORE_GUILD_ALLOWLIST"] = "100000000000000091";
    resetConfigurationForTests();
    let writes = 0;
    const put: DiscordCommandPut = () => {
      writes += 1;
      return Promise.resolve(undefined);
    };

    await reconcileGuildScopedCommands(["100000000000000091"], put);
    await reconcileGuildScopedCommands(["100000000000000091"], put, {
      force: true,
    });

    expect(writes).toBe(2);
  });
});
