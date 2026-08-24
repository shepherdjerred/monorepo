import { describe, expect, test, vi } from "vitest";
import { Client, GatewayIntentBits } from "discord.js";
import {
  DISCORD_EVENT_NAMES,
  registerDiscordEventHandlers,
  startDiscordGateway,
} from "#src/discord/bootstrap.ts";

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
