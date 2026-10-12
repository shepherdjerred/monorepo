import { test as base } from "./fixtures.ts";
import { RconClient } from "./harness/rcon.ts";

/** Arena selectors and block commands need the arena dimension after the world split. */
// Fixture movement uses minecraft:tp: Bukkit's tp alias ignores execute-in's world.
export const test = base.extend("rcon", async ({ server }, { onCleanup }) => {
  const rcon = await RconClient.connect({
    host: server.host,
    port: server.rconPort,
    password: server.rconPassword,
    world: "settlement",
  });
  onCleanup(() => {
    rcon.close();
  });
  return rcon;
});
