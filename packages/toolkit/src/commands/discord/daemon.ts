import path from "node:path";
import { DISCORD_DIR } from "#lib/discord/ipc.ts";
import { renderStatus } from "#lib/discord/render.ts";
import {
  cleanDeadDiscordDaemonFiles,
  ensureDiscordDaemon,
  probeDiscordDaemonStatus,
  stopDiscordDaemon,
} from "#lib/discord/spawn.ts";

export async function daemonStartCommand(options: {
  ttlSeconds: number;
  passwordLogin?: boolean;
  userOnly?: boolean;
}): Promise<void> {
  const { status, started } = await ensureDiscordDaemon(options);
  console.log(renderStatus(status));
  console.log(
    started
      ? "\nDaemon started. Tokens stay in daemon memory — no further op calls needed this session."
      : "\nDaemon already running; attached to existing session.",
  );
}

export async function daemonStopCommand(): Promise<void> {
  await stopDiscordDaemon();
  console.log("Discord daemon stopped.");
}

export async function daemonStatusCommand(options: {
  json: boolean;
}): Promise<void> {
  const status = await probeDiscordDaemonStatus();
  if (status === null) {
    await cleanDeadDiscordDaemonFiles();
    console.log("Discord daemon is not running.");
    process.exitCode = 1;
    return;
  }
  if (options.json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  console.log(renderStatus(status));
  console.log(`\nLogs: ${path.join(DISCORD_DIR, "logs")}`);
}
