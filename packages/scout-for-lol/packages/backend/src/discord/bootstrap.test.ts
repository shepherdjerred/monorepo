import { describe, expect, test, vi } from "vitest";
import {
  Client,
  Events,
  GatewayIntentBits,
  ShardEvents,
  type Guild,
} from "discord.js";
import {
  claimGuildInstallReplacement,
  DISCORD_EVENT_NAMES,
  registerDiscordEventHandlers,
  runGuildConfigRefresh,
  startDiscordGateway,
  updateHistoricalUnavailableGuilds,
} from "#src/discord/bootstrap.ts";
import { mockGuild } from "#src/testing/discord-mocks.ts";
import type { GuildInstallReplacement } from "#src/discord/events/guild-create.ts";

function newClient(): Client {
  return new Client({ intents: [GatewayIntentBits.Guilds] });
}

/**
 * discord.js installs a few listeners of its own in the constructor, so these
 * assertions count what the bootstrap adds rather than what is present.
 */
function listenerCounts(client: Client): Record<string, number> {
  return Object.fromEntries(
    DISCORD_EVENT_NAMES.map((event) => [event, client.listenerCount(event)]),
  );
}

describe("discord bootstrap", () => {
  test("every handled event is a real Client event", () => {
    // The listener-count assertions below cannot catch a misspelled or
    // wrong-class event: `Client` is an `AsyncEventEmitter` whose key type
    // accepts any string, so `client.on("disconnect", …)` compiles, registers,
    // counts as installed — and never fires. That is exactly what happened:
    // the list carried discord.js v12's `disconnect` and `reconnecting`, which
    // in v14 belong to the sharding manager's `Shard`, so the beta bot lost
    // its gateway for 34 minutes without logging a line or moving
    // `discord_connection_status` off 1.
    const clientEvents = new Set<string>(Object.values(Events));
    const shardManagerEvents = new Set<string>(Object.values(ShardEvents));

    for (const event of DISCORD_EVENT_NAMES) {
      expect(clientEvents).toContain(event);
    }
    // `ShardEvents.Disconnect` and `ShardEvents.Reconnecting` collide by name
    // with nothing on `Client`, which is why the mistake was invisible.
    expect(shardManagerEvents).not.toContain(Events.ShardDisconnect);
  });

  test("reports gateway loss on the shard events discord.js actually emits", () => {
    const client = newClient();
    registerDiscordEventHandlers(client);

    for (const event of [
      Events.ShardDisconnect,
      Events.ShardReconnecting,
      Events.ShardError,
      Events.ShardReady,
      Events.ShardResume,
    ]) {
      expect(client.listenerCount(event)).toBeGreaterThan(0);
    }
  });

  test("installs exactly one handler for every gateway event the bot handles", () => {
    const client = newClient();
    const before = listenerCounts(client);

    registerDiscordEventHandlers(client);

    const after = listenerCounts(client);
    expect(after).toEqual(
      Object.fromEntries(
        DISCORD_EVENT_NAMES.map((event) => [event, (before[event] ?? 0) + 1]),
      ),
    );
  });

  test("installs every handler before login is attempted", async () => {
    // A fast gateway connection can emit `ready` the moment login resolves, so
    // a handler registered afterwards would never run. Capture what is
    // registered at the instant login is called.
    const client = newClient();
    let eventsAtLogin: string[] = [];
    const login = vi.spyOn(client, "login").mockImplementation(() => {
      eventsAtLogin = client.eventNames().map(String);
      return Promise.resolve("stub-token");
    });

    // NODE_ENV is "test" under vitest, which short-circuits the real login.
    // Drive the production branch explicitly instead.
    const previousNodeEnv = Bun.env.NODE_ENV;
    Bun.env.NODE_ENV = "production";
    try {
      await startDiscordGateway(client);
    } finally {
      if (previousNodeEnv === undefined) {
        delete Bun.env.NODE_ENV;
      } else {
        Bun.env.NODE_ENV = previousNodeEnv;
      }
    }

    expect(login).toHaveBeenCalledTimes(1);
    for (const event of DISCORD_EVENT_NAMES) {
      expect(eventsAtLogin).toContain(event);
    }
  });

  test("skips login under NODE_ENV=test but still installs handlers", async () => {
    const client = newClient();
    const login = vi.spyOn(client, "login").mockResolvedValue("stub-token");

    await startDiscordGateway(client);

    expect(login).not.toHaveBeenCalled();
    for (const event of DISCORD_EVENT_NAMES) {
      expect(client.listenerCount(event)).toBeGreaterThan(0);
    }
  });
});

describe("runGuildConfigRefresh", () => {
  test("a command-reconciliation REST failure never blocks the voice sweep", async () => {
    const calls: string[] = [];
    await runGuildConfigRefresh(["guild-1"], {
      sweepDisabledVoiceSessions: () => {
        calls.push("sweep");
        return Promise.resolve();
      },
      reconcileCommands: () => {
        calls.push("reconcile");
        return Promise.reject(new Error("Discord REST 500"));
      },
    });
    expect(calls).toEqual(["sweep", "reconcile"]);
  });

  test("a voice-sweep failure never blocks command reconciliation", async () => {
    const calls: string[] = [];
    await runGuildConfigRefresh(["guild-1"], {
      sweepDisabledVoiceSessions: () => {
        calls.push("sweep");
        return Promise.reject(new Error("flag evaluation failed"));
      },
      reconcileCommands: (guildIds) => {
        calls.push(`reconcile:${[...guildIds].join(",")}`);
        return Promise.resolve();
      },
    });
    expect(calls).toEqual(["sweep", "reconcile:guild-1"]);
  });

  test("the sweep runs before command reconciliation", async () => {
    const order: string[] = [];
    await runGuildConfigRefresh([], {
      sweepDisabledVoiceSessions: async () => {
        await Bun.sleep(1);
        order.push("sweep");
      },
      reconcileCommands: () => {
        order.push("reconcile");
        return Promise.resolve();
      },
    });
    expect(order).toEqual(["sweep", "reconcile"]);
  });
});

describe("observed removal claims", () => {
  test("clears only an accepted removal generation", () => {
    const acceptedGuild = mockGuild({ id: "guild-1" });
    const oldRemoval = {
      identity: Symbol("old removal"),
      observedAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    const laterRemoval = {
      identity: Symbol("later removal"),
      observedAt: new Date("2026-01-02T00:00:00.000Z"),
    };
    const observedRemovals = new Map([[acceptedGuild.id, oldRemoval]]);
    const replacementGuilds = new WeakMap<Guild, GuildInstallReplacement>();

    const oldClaim = claimGuildInstallReplacement({
      replacementGuilds,
      observedRemovals,
      guild: acceptedGuild,
      observedRemoval: oldRemoval,
    });
    expect(oldClaim?.replacement).toEqual({
      kind: "observed-removal",
      observedAt: oldRemoval.observedAt,
    });
    expect(observedRemovals.get(acceptedGuild.id)).toBe(oldRemoval);

    observedRemovals.set(acceptedGuild.id, laterRemoval);
    oldClaim?.accept();
    expect(observedRemovals.get(acceptedGuild.id)).toBe(laterRemoval);

    const laterClaim = claimGuildInstallReplacement({
      replacementGuilds,
      observedRemovals,
      guild: acceptedGuild,
      observedRemoval: laterRemoval,
    });
    laterClaim?.accept();
    expect(observedRemovals.has(acceptedGuild.id)).toBe(false);
  });

  test("keeps an updated replacement generation claimable", () => {
    const guild = mockGuild({ id: "guild-1" });
    const pending: GuildInstallReplacement = {
      kind: "reconciliation-pending-retirement",
      analyticsInstallationId: "pending-installation",
    };
    const completed: GuildInstallReplacement = {
      kind: "reconciliation",
      analyticsInstallationId: "pending-installation",
      retiredAttribution: {
        tokenIds: [101],
        retiredAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    };
    const replacementGuilds = new WeakMap([[guild, pending]]);
    const claim = claimGuildInstallReplacement({
      replacementGuilds,
      observedRemovals: new Map(),
      guild,
      observedRemoval: undefined,
    });

    expect(claim?.update(completed)).toBe(true);
    expect(replacementGuilds.get(guild)).toBe(completed);
    const refreshedClaim = claimGuildInstallReplacement({
      replacementGuilds,
      observedRemovals: new Map(),
      guild,
      observedRemoval: undefined,
    });
    expect(refreshedClaim?.replacement).toBe(completed);
    refreshedClaim?.accept();
    expect(replacementGuilds.has(guild)).toBe(false);
  });
});

describe("historical unavailable guild markers", () => {
  test("preserves an in-flight marker when a later ready sees the same guild available", () => {
    const guild = mockGuild({ id: "guild-1" });
    Object.defineProperty(guild, "available", { value: true });
    const markers = new Map([[guild.id, guild]]);

    updateHistoricalUnavailableGuilds(markers, [guild]);

    expect(markers.get(guild.id)).toBe(guild);
  });
});
