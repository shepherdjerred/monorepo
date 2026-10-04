#!/usr/bin/env bun
/**
 * Boots a local Paper server with every shipped module plus Search and Destroy
 * and its Citizens bots, so a real Minecraft client can join `localhost` and
 * watch a bots-only showcase. The server runs until Ctrl-C, then the
 * container is removed. Build TheStorm.jar first (`bun run build`).
 *
 *   bun run rwf:watch [--port 25565] [--op <player name>]
 */
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { gameplayFixtures } from "#e2e/gameplay-fixtures.ts";
import { startFakeBrain } from "#e2e/harness/fake-brain.ts";
import { ownedConfigDir, packageRoot, stormJar } from "#e2e/harness/paths.ts";
import {
  rwfRecordingSalt,
  rwfTestSettings,
} from "#e2e/harness/rwf-settings.ts";
import { startServer } from "#e2e/harness/server.ts";
import { RconClient } from "@shepherdjerred/the-storm-brain/rcon";

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

if (!(await Bun.file(stormJar).exists())) {
  throw new Error(
    `${stormJar} is missing; build it first with: bunx turbo run build --filter=@shepherdjerred/the-storm`,
  );
}

const brainToken = crypto.randomUUID();
const brain = startFakeBrain(brainToken);
const brainBaseUrl = `http://host.docker.internal:${brain.port.toString()}`;
const fixtures = await gameplayFixtures(packageRoot, "full");
console.warn(
  "Booting Paper with rwf and rwfbots; the first boot downloads Paper and plugins…",
);
const server = await startServer({
  cacheDir: path.join(packageRoot, ".cache", "e2e", "watch"),
  bootTimeoutMs: 300_000,
  warmCache: true,
  stormJar,
  ...fixtures,
  // Close to production pacing for watching: a 15 s countdown, the owned
  // targetCombatants (8), a readable end screen, and no load test.
  rwf: {
    ...rwfTestSettings,
    countdown: "PT15S",
    endLinger: "PT15S",
    noHumansAbort: "PT30S",
  },
  ownedConfigDir,
  gamePort: args.port,
  env: {
    // The fake brain's Flipt double admits /rwf join and /rwf spectate.
    FLIPT_URL: brainBaseUrl,
    FLIPT_ENVIRONMENT: "prod",
    RWF_RECORDING_SALT: rwfRecordingSalt,
    // The discord module needs a token; this malformed one never logs in.
    DISCORD_BOT_TOKEN: "invalid-storm-fixture-token",
    DISCORD_CHANNEL_ID: "1",
  },
  brain: { baseUrl: brainBaseUrl, token: brainToken },
  sweep: {
    intervalMinutes: 1,
    redriveAfterMinutes: 0,
    redriveBackoffMinutes: 0,
    slaAfterMinutes: 10_080,
  },
  agent: { mode: "shadow", reviewSamplePercent: 100 },
});

let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.warn("\nStopping the server and removing its container…");
  await server.stop();
  await brain.stop();
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
