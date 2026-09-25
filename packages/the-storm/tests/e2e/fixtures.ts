import { randomBytes } from "node:crypto";
import { inject, test as base } from "vitest";
import { connectBot, disconnectBot, waitUntil } from "./harness/bot.ts";
import { RconClient } from "./harness/rcon.ts";

/** Unique per test so player data (inventory, op, position) never leaks between tests. */
function username(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString("hex")}`;
}

export const test = base
  .extend("server", { scope: "file" }, () => inject("server"))
  .extend("rcon", async ({ server }, { onCleanup }) => {
    const rcon = await RconClient.connect({
      host: server.host,
      port: server.rconPort,
      password: server.rconPassword,
    });
    onCleanup(() => {
      rcon.close();
    });
    return rcon;
  })
  .extend("bot", async ({ server }, { onCleanup }) => {
    const bot = await connectBot({
      host: server.host,
      port: server.gamePort,
      username: username("a"),
    });
    onCleanup(async () => disconnectBot(bot));
    return bot;
  })
  // Depends on `bot` so both are online together for multi-player flows.
  .extend("secondBot", async ({ server, bot }, { onCleanup }) => {
    const second = await connectBot({
      host: server.host,
      port: server.gamePort,
      username: username("b"),
    });
    try {
      await waitUntil(
        "first bot sees the second join",
        () => bot.players[second.username] !== undefined,
      );
    } catch (error) {
      await disconnectBot(second);
      throw error;
    }
    onCleanup(async () => disconnectBot(second));
    return second;
  });
