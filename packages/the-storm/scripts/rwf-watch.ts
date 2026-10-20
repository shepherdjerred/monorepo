#!/usr/bin/env bun
/**
 * Boots a local Paper server with every shipped module plus Search and Destroy
 * and its Citizens bots, so a real Minecraft client can join `localhost` and
 * watch a bots-only showcase. The server runs until Ctrl-C, then the
 * container is removed. Build TheStorm.jar first (`bun run build`).
 *
 *   bun run rwf:watch [--port 25565] [--op <player name>]
 */
import { parseArgs } from "node:util";
import { z } from "zod";
import { startLocalStorm } from "./bots/local-storm.ts";
import { stormJar } from "#e2e/harness/paths.ts";
import { RconClient } from "#e2e/harness/rcon.ts";
import { rwfTestSettings } from "#e2e/harness/rwf-settings.ts";

const ArgsSchema = z.object({
  port: z.coerce.number().int().min(1).max(65_535),
  op: z
    .string()
    .regex(/^\w{3,16}$/u)
    .optional(),
});

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "25565" },
    op: { type: "string" },
  },
});
const args = ArgsSchema.parse(values);

console.warn(
  "Booting Paper with rwf and rwfbots; the first boot downloads Paper and plugins…",
);
const server = await startLocalStorm({
  cacheName: "watch",
  stormJar,
  // Close to production pacing for watching: a 45 s countdown (time to watch
  // the bots walk in, wander, try kits and talk in the lobby), the owned
  // targetCombatants (8), a readable end screen, and no load test.
  rwf: {
    ...rwfTestSettings,
    countdown: "PT45S",
    endLinger: "PT15S",
    noHumansAbort: "PT30S",
  },
  gamePort: args.port,
});

let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.warn("\nStopping the server and removing its container…");
  await server.stop();
  process.exit(0);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());

if (args.op !== undefined) {
  const rcon = await RconClient.connect({
    host: server.info.host,
    port: server.info.rconPort,
    password: server.info.rconPassword,
  });
  console.warn(await rcon.command(`op ${args.op}`));
  rcon.close();
}

console.warn(`
The Storm is up with Search and Destroy bots (offline mode).

Join:  localhost:${args.port.toString()}   (Minecraft 26.2; older clients go through ViaBackwards)
${args.op === undefined ? "Op yourself: rerun with --op <name>, or the showcase command is refused.\n" : `${args.op} is an operator.\n`}
Then, in game:
  1. /rwf admin showcase 8   start a bots-only match (15 s countdown)
  2. /rwf spectate           watch from the spectator point
  3. /rwf spectate next      follow the next living fighter (repeat to cycle)
  /rwf leave                 stop watching and get your belongings back
  /rwfbots debug             the bots' plans and the governor

Press Ctrl-C to stop the server and remove the container.`);

// Keep the process alive until a signal stops the server.
await new Promise<never>(() => {
  // Never settles: SIGINT and SIGTERM end the process through stop().
});
