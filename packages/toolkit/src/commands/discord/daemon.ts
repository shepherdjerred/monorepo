import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { daemonRequest } from "#lib/discord/client.ts";
import {
  type DaemonState,
  DaemonStateSchema,
  DISCORD_DIR,
  LOGS_DIR,
  pathExists,
  SOCKET_PATH,
  STATE_PATH,
  StatusResponseSchema,
} from "#lib/discord/ipc.ts";
import { renderStatus } from "#lib/discord/render.ts";

async function readState(): Promise<DaemonState | null> {
  if (!(await pathExists(STATE_PATH))) {
    return null;
  }
  const raw: unknown = JSON.parse(await Bun.file(STATE_PATH).text());
  return DaemonStateSchema.parse(raw);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function daemonLogPath(): string {
  const day = new Date().toISOString().slice(0, 10);
  return path.join(LOGS_DIR, `daemon-${day}.log`);
}

// When running from source, process.execPath is the bun binary and Bun.main is
// the entry script; in the compiled binary, process.execPath IS the toolkit
// binary and re-invoking it directly is correct.
function serveArgv(): string[] {
  const isCompiled = !path.basename(process.execPath).startsWith("bun");
  return isCompiled
    ? [process.execPath, "discord", "serve"]
    : [process.execPath, "run", Bun.main, "discord", "serve"];
}

export async function daemonStartCommand(options: {
  ttlSeconds: number;
}): Promise<void> {
  const existing = await readState();
  if (existing !== null && pidAlive(existing.pid)) {
    console.error(
      `Discord daemon is already running (pid ${String(existing.pid)}). Use 'toolkit discord daemon stop' first.`,
    );
    process.exit(1);
  }
  const botToken = Bun.env["DISCORD_BOT_TOKEN"];
  const userToken = Bun.env["DISCORD_USER_TOKEN"];
  if (
    (botToken == null || botToken.length === 0) &&
    (userToken == null || userToken.length === 0)
  ) {
    console.error(
      "Set DISCORD_BOT_TOKEN and/or DISCORD_USER_TOKEN in the environment before starting the daemon.\nAsk the user which 1Password item holds the right tokens, then load them with one batched op call wrapping this command.",
    );
    process.exit(1);
  }

  await mkdir(LOGS_DIR, { recursive: true });
  await rm(SOCKET_PATH, { force: true });
  await rm(STATE_PATH, { force: true });

  const [command, ...args] = serveArgv();
  if (command === undefined) {
    throw new Error("could not determine daemon command");
  }
  // Detached + stdio ignore: the daemon writes its own logs to LOGS_DIR.
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    env: {
      ...Bun.env,
      TOOLKIT_DISCORD_TTL_SECONDS: String(options.ttlSeconds),
    },
  });
  child.unref();

  // Logins can take a while; poll until the daemon reports ready.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (child.exitCode !== null) {
      console.error(
        `Daemon exited early with code ${String(child.exitCode)}. Logs: ${daemonLogPath()}`,
      );
      process.exit(1);
    }
    if (!(await pathExists(SOCKET_PATH))) {
      continue;
    }
    try {
      const status = await daemonRequest(StatusResponseSchema, "/status");
      console.log(renderStatus(status));
      console.log(
        "\nDaemon started. Tokens stay in daemon memory — no further op calls needed this session.",
      );
      return;
    } catch {
      // socket exists but server not accepting yet — keep polling
    }
  }
  console.error(`Daemon did not become ready in 60s. Logs: ${daemonLogPath()}`);
  process.exit(1);
}

export async function daemonStopCommand(): Promise<void> {
  const state = await readState();
  if (await pathExists(SOCKET_PATH)) {
    try {
      await daemonRequest(StatusResponseSchema.partial(), "/shutdown", {});
    } catch {
      // fall through to pid kill
    }
  }
  if (state !== null && pidAlive(state.pid)) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && pidAlive(state.pid)) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (pidAlive(state.pid)) {
      process.kill(state.pid, "SIGTERM");
    }
  }
  await rm(SOCKET_PATH, { force: true });
  await rm(STATE_PATH, { force: true });
  console.log("Discord daemon stopped.");
}

export async function daemonStatusCommand(options: {
  json: boolean;
}): Promise<void> {
  if (!(await pathExists(SOCKET_PATH))) {
    const state = await readState();
    if (state !== null && !pidAlive(state.pid)) {
      console.log(
        "Discord daemon is not running (stale state file — run 'toolkit discord daemon stop' to clean up).",
      );
    } else {
      console.log("Discord daemon is not running.");
    }
    process.exitCode = 1;
    return;
  }
  const status = await daemonRequest(StatusResponseSchema, "/status");
  if (options.json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  console.log(renderStatus(status));
  console.log(`\nLogs: ${path.join(DISCORD_DIR, "logs")}`);
}
