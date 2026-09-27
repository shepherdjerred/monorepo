import path from "node:path";
import { realpath, stat } from "node:fs/promises";
import mineflayer from "mineflayer";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { loadBootstrap, loadPilotConfig } from "./config.ts";
import { humanPlayers, inPilotWindow, privateAuthCacheMode } from "./policy.ts";
import { RconClient } from "./rcon.ts";
import { mineflayerClient, runSession } from "./session.ts";

const CONFIG = new URL("../pilot.json", import.meta.url).pathname;

async function run(): Promise<void> {
  const command = Bun.argv[2];
  if (command !== "--check" && command !== "--run") {
    throw new Error("usage: bun run pilot --check | --run");
  }
  await initFeatureFlags({
    onInitializationFailure: (message) => {
      console.warn(`companion pilot flag source unavailable: ${message}`);
    },
  });
  try {
    await runWithFlags(command);
  } finally {
    await shutdownFeatureFlags();
  }
}

async function runWithFlags(command: "--check" | "--run"): Promise<void> {
  const config = await loadPilotConfig(
    CONFIG,
    createFlagConfigSource({
      targetingKey: "the-storm-companion-alt-1",
      kinds: { enabled: "boolean" },
      attributes: { pilot: "alt-1" },
    }),
  );
  const inWindow = inPilotWindow(config, new Date());
  if (command === "--check") {
    process.stdout.write(
      `pilot ${config.enabled ? "enabled" : "disabled"}; window ${inWindow ? "open" : "closed"}\n`,
    );
    return;
  }
  if (!inWindow || !config.enabled) {
    throw new Error("pilot is disabled or outside the configured window");
  }
  const credentials = loadBootstrap(Bun.env);
  if (!path.isAbsolute(credentials.MINECRAFT_AUTH_CACHE_DIR)) {
    throw new Error("Microsoft auth cache path must be absolute");
  }
  const cache = await stat(credentials.MINECRAFT_AUTH_CACHE_DIR);
  const uid = process.getuid?.();
  if (
    uid === undefined ||
    !cache.isDirectory() ||
    cache.uid !== uid ||
    !privateAuthCacheMode(cache.mode)
  ) {
    throw new Error(
      "Microsoft auth cache directory must be private (mode 0700)",
    );
  }
  const actualCachePath = await realpath(credentials.MINECRAFT_AUTH_CACHE_DIR);
  const workspaceRoot = path.resolve(import.meta.dirname, "../../../..");
  if (
    actualCachePath === workspaceRoot ||
    actualCachePath.startsWith(`${workspaceRoot}/`)
  ) {
    throw new Error(
      "Microsoft auth cache directory must be outside the repository",
    );
  }

  const rcon = await RconClient.connect({
    host: config.rconHost,
    port: config.rconPort,
    password: credentials.MINECRAFT_RCON_PASSWORD,
  });
  try {
    // A previous pilot connection can still be online after this process exits.
    const before = humanPlayers(
      await rcon.command("list"),
      config.botPlayerName,
    );
    if (before.length === 0) {
      process.stdout.write("pilot skipped: no human online\n");
      return;
    }
    if (!inPilotWindow(config, new Date())) {
      process.stdout.write(
        "pilot skipped: window closed before authentication\n",
      );
      return;
    }
    const bot = mineflayer.createBot({
      host: config.minecraftHost,
      port: config.minecraftPort,
      username: credentials.MINECRAFT_BOT_EMAIL,
      auth: "microsoft",
      profilesFolder: actualCachePath,
      version: config.clientVersion,
      hideErrors: true,
    });
    try {
      const outcome = await runSession(mineflayerClient(bot), rcon, config);
      process.stdout.write(`pilot ended: ${outcome}\n`);
    } finally {
      bot.quit();
    }
  } finally {
    rcon.close();
  }
}

await run();
