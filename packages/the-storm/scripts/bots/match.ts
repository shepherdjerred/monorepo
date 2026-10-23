#!/usr/bin/env bun
/**
 * Plays one bots-only Search and Destroy showcase on a chosen map in a
 * disposable Paper server and keeps its bot decision trace and match
 * recording, for diagnosing bot movement offline with `bun run bots:stuck`.
 * Every 20 s of live play it also appends `/rwfbots debug` (each bot's plan
 * and movement problems this life) to `<output>/debug.log`.
 *
 *   bun run bots:match --map the-harshest-harvest --count 24 --output .cache/bots-match/hh
 *
 * Build the jar first (`bunx turbo run build --filter=@shepherdjerred/the-storm`).
 */
import { appendFile, cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { startLocalStorm } from "./local-storm.ts";
import { stormJar } from "#e2e/harness/paths.ts";
import { RconClient } from "#e2e/harness/rcon.ts";
import { status } from "#e2e/harness/rwf-match.ts";
import { rwfTestSettings } from "#e2e/harness/rwf-settings.ts";

const ArgsSchema = z.object({
  map: z.string().regex(/^[a-z0-9-]+$/u),
  count: z.coerce.number().int().min(2).max(256),
  output: z.string().min(1),
  minutes: z.coerce.number().positive().max(30),
  jar: z.string().min(1),
});

const { values } = parseArgs({
  options: {
    map: { type: "string" },
    count: { type: "string", default: "24" },
    output: { type: "string" },
    minutes: { type: "string", default: "12" },
    // Another build of TheStorm.jar, to compare bots before and after a change.
    jar: { type: "string", default: stormJar },
  },
});
const args = ArgsSchema.parse(values);
const output = path.resolve(args.output);

await mkdir(output, { recursive: true });
const dataDir = path.join(output, "data");

const server = await startLocalStorm({
  cacheName: "bots-match",
  stormJar: path.resolve(args.jar),
  dataDir,
  rwfMap: args.map,
  rwf: { ...rwfTestSettings, countdown: "PT15S", endLinger: "PT5S" },
  resources: { cpus: 4, memoryLimit: "6g", heap: "4G" },
});

try {
  const rcon = await RconClient.connect({
    host: server.info.host,
    port: server.info.rconPort,
    password: server.info.rconPassword,
  });
  // The first map is still being prepared after boot; the showcase is refused until it is ready.
  const ready = Date.now() + 300_000;
  for (
    let lobby = await status(rcon);
    !lobby.ready;
    lobby = await status(rcon)
  ) {
    if (Date.now() > ready) throw new Error("the lobby map never became ready");
    await Bun.sleep(2000);
  }
  const started = await rcon.command(
    `rwf admin showcase ${args.count.toString()}`,
  );
  console.warn(started);
  if (!started.includes("Showcase of"))
    throw new Error("the showcase was refused");
  const deadline = Date.now() + args.minutes * 60_000;
  let matchId: string | undefined;
  let nextDebug = 0;
  for (;;) {
    const now = await status(rcon);
    if (now.phase === "Live") matchId ??= now.matchId;
    if (now.phase === "Live" && Date.now() >= nextDebug) {
      // Each bot's plan and movement problems, which the decision trace does not carry.
      nextDebug = Date.now() + 20_000;
      const debug = await rcon.command("rwfbots debug");
      await appendFile(
        path.join(output, "debug.log"),
        `--- ${new Date().toISOString()}\n${debug}\n`,
      );
    }
    if (matchId !== undefined && now.phase !== "Live") break;
    if (Date.now() > deadline) {
      console.warn(`stopping after ${args.minutes.toString()} minutes`);
      // A recording is written only when its match ends, so a match still live at the deadline is
      // stopped and given time to settle rather than lost with the server.
      if (now.phase === "Live") await stopMatch(rcon);
      break;
    }
    await Bun.sleep(2000);
  }
  rcon.close();
  console.warn(`match ${matchId ?? "never went live"}`);
} finally {
  await server.stop();
}

const storm = path.join(dataDir, "plugins", "TheStorm");
for (const [from, to] of [
  ["rwfbots-traces", "traces"],
  ["rwf-recordings", "recordings"],
] as const) {
  const source = path.join(storm, from);
  await cp(source, path.join(output, to), { recursive: true });
  const files = await readdir(path.join(output, to), { recursive: true });
  console.warn(
    `${to}: ${files.filter((file) => file.endsWith(".gz")).join(", ")}`,
  );
}

/** Stops the live match and waits until it has left the live phase, so its recording is written. */
async function stopMatch(rcon: RconClient): Promise<void> {
  console.warn(await rcon.command("rwf admin stop"));
  const settled = Date.now() + 60_000;
  for (
    let now = await status(rcon);
    now.phase === "Live";
    now = await status(rcon)
  ) {
    if (Date.now() > settled)
      throw new Error("the match never left the live phase");
    await Bun.sleep(1000);
  }
}
