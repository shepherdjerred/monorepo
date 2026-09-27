import path from "node:path";
import { realpath, stat } from "node:fs/promises";
import mineflayer from "mineflayer";
import type { Bot } from "mineflayer";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { createFlagConfigSource } from "@shepherdjerred/feature-flags/config-source.ts";
import { loadBootstrap, loadPilotConfig } from "./config.ts";
import type { PilotConfig } from "./config.ts";
import {
  humanPlayers,
  inPilotWindow,
  onlinePlayers,
  privateAuthCacheMode,
} from "./policy.ts";
import { RconClient } from "./rcon.ts";

const CONFIG = new URL("../pilot.json", import.meta.url).pathname;

function waitForSpawn(bot: Bot): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      finish(new Error("bot spawn timed out"));
    }, 30_000);
    const onSpawn = () => {
      finish();
    };
    const onError = () => {
      finish(new Error("bot connection failed"));
    };
    const onEnd = () => {
      finish(new Error("bot disconnected before spawn"));
    };
    const onKicked = () => {
      finish(new Error("bot was kicked before spawn"));
    };
    function finish(error?: Error) {
      clearTimeout(timer);
      bot.off("spawn", onSpawn);
      bot.off("error", onError);
      bot.off("end", onEnd);
      bot.off("kicked", onKicked);
      if (error === undefined) resolve();
      else reject(error);
    }
    bot.once("spawn", onSpawn);
    bot.on("error", onError);
    bot.on("end", onEnd);
    bot.on("kicked", onKicked);
  });
}

async function verifySpawn(
  bot: Bot,
  rcon: RconClient,
  config: PilotConfig,
): Promise<void> {
  await waitForSpawn(bot);
  if (!inPilotWindow(config, new Date())) {
    process.stdout.write("pilot ended: window closed before spawn\n");
    return;
  }
  const online = onlinePlayers(await rcon.command("list"));
  if (!online.includes(bot.username)) {
    throw new Error("bot left before the post-spawn presence check completed");
  }
  const after = online.filter((player) => player !== bot.username);
  if (!inPilotWindow(config, new Date())) {
    process.stdout.write("pilot ended: window closed during spawn check\n");
    return;
  }
  if (after.length === 0) {
    process.stdout.write("pilot ended: human left before spawn\n");
    return;
  }
  process.stdout.write("pilot connected and verified human presence\n");
}

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
  const botPlayerName = Bun.env["MINECRAFT_BOT_PLAYER_NAME"];
  if (botPlayerName === undefined || !/^\w{3,16}$/u.test(botPlayerName)) {
    throw new Error("MINECRAFT_BOT_PLAYER_NAME must be a valid player name");
  }
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
    const before = humanPlayers(await rcon.command("list"), botPlayerName);
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
      await verifySpawn(bot, rcon, config);
    } finally {
      bot.quit();
    }
  } finally {
    rcon.close();
  }
}

await run();
