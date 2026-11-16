import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  daemonRunning,
  pathExists,
  stopDaemonPid,
  terminateDaemonChild,
  withDaemonStartLock,
} from "@shepherdjerred/unix-socket-daemon";
import { discordDaemonEnvironment } from "#lib/discord/auth.ts";
import {
  type DaemonState,
  DaemonStateSchema,
  DEFAULT_TTL_SECONDS,
  LOGS_DIR,
  SOCKET_PATH,
  STATE_PATH,
  type StatusResponse,
  StatusResponseSchema,
} from "#lib/discord/ipc.ts";

/** Every daemon process command line contains this (`<toolkit|bun run main> discord serve`). */
export const DISCORD_DAEMON_MARKER = "discord serve";

const START_LOCK_PATH = `${SOCKET_PATH}.lock`;
const STARTUP_TIMEOUT_MS = 60_000;

const MISSING_TOKEN_MESSAGE = [
  "toolkit could not resolve DISCORD_BOT_TOKEN or DISCORD_USER_TOKEN (env, ~/.toolkit/config.toml [credentials], macOS Keychain).",
  "Enroll each token in the Keychain, then retry:",
  "swift scripts/onepassword/enroll-workstation-secret.swift --service monorepo-workstation-discord-bot-token --ref op://Personal/ytv272dyktkeipt347f2yf5kue/BOT_TOKEN",
  "swift scripts/onepassword/enroll-workstation-secret.swift --service monorepo-workstation-discord-user-token --ref op://Personal/sskm6skq3mwnyqnhrmqwji6dne/TOKEN",
].join("\n");

export async function readDiscordDaemonState(): Promise<DaemonState | null> {
  if (!(await pathExists(STATE_PATH))) {
    return null;
  }
  try {
    const raw: unknown = JSON.parse(await Bun.file(STATE_PATH).text());
    const parsed = DaemonStateSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function discordDaemonLogPath(): string {
  const day = new Date().toISOString().slice(0, 10);
  return path.join(LOGS_DIR, `daemon-${day}.log`);
}

export function hasAutoStartDiscordTokens(
  source: Readonly<Record<string, string | undefined>> = Bun.env,
): boolean {
  return (
    (source["DISCORD_BOT_TOKEN"] ?? "").length > 0 ||
    (source["DISCORD_USER_TOKEN"] ?? "").length > 0
  );
}

// When running from source, process.execPath is the bun binary and Bun.main is
// the entry script; in the compiled binary, process.execPath IS the toolkit
// binary and re-invoking it directly is correct.
function serveArgv(passwordLogin: boolean, userOnly: boolean): string[] {
  const isCompiled = !path.basename(process.execPath).startsWith("bun");
  const argv = isCompiled
    ? [process.execPath, "discord", "serve"]
    : [process.execPath, "run", Bun.main, "discord", "serve"];
  return [
    ...argv,
    ...(passwordLogin ? ["--password-login"] : []),
    ...(userOnly ? ["--user-only"] : []),
  ];
}

function assertDaemonCredentials(
  passwordLogin: boolean,
  userOnly: boolean,
): void {
  const botToken =
    passwordLogin || userOnly ? undefined : Bun.env["DISCORD_BOT_TOKEN"];
  const userToken = passwordLogin ? undefined : Bun.env["DISCORD_USER_TOKEN"];
  if (userOnly && (userToken === undefined || userToken === "")) {
    throw new Error("User-only Discord daemon requires DISCORD_USER_TOKEN");
  }
  if (
    passwordLogin &&
    ((Bun.env["DISCORD_USER_EMAIL"] ?? "") === "" ||
      (Bun.env["DISCORD_USER_PASSWORD"] ?? "") === "")
  ) {
    throw new Error(
      "Password login requires parent-injected DISCORD_USER_EMAIL and DISCORD_USER_PASSWORD",
    );
  }
  if (
    !passwordLogin &&
    (botToken == null || botToken.length === 0) &&
    (userToken == null || userToken.length === 0)
  ) {
    throw new Error(MISSING_TOKEN_MESSAGE);
  }
}

/**
 * Probes `/status` directly over `SOCKET_PATH` without triggering auto-start.
 * Returns `null` when the socket is absent or refuses connection.
 */
export async function probeDiscordDaemonStatus(): Promise<StatusResponse | null> {
  if (!(await pathExists(SOCKET_PATH))) {
    return null;
  }
  let response: Response;
  try {
    response = await fetch("http://daemon/status", {
      unix: SOCKET_PATH,
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `Discord daemon status failed (HTTP ${String(response.status)})`,
    );
  }
  return StatusResponseSchema.parse(await response.json());
}

/** Removes leftover `daemon.sock` / `state.json` when no live daemon owns them. */
export async function cleanDeadDiscordDaemonFiles(): Promise<boolean> {
  const state = await readDiscordDaemonState();
  if (
    state !== null &&
    (await daemonRunning(state.pid, DISCORD_DAEMON_MARKER))
  ) {
    return false;
  }
  if ((await probeDiscordDaemonStatus()) !== null) {
    return false;
  }
  await rm(SOCKET_PATH, { force: true });
  await rm(STATE_PATH, { force: true });
  return true;
}

function assertCompatibleRunningDaemon(
  status: StatusResponse,
  options: { passwordLogin: boolean; userOnly: boolean },
): void {
  if (options.passwordLogin) {
    throw new Error(
      `Discord daemon is already running (pid ${String(status.pid)}). Use 'toolkit discord daemon stop' before starting --password-login.`,
    );
  }
  if (options.userOnly && status.identities.bot !== undefined) {
    throw new Error(
      `Discord daemon is already running with bot credentials (pid ${String(status.pid)}). Use 'toolkit discord daemon stop' before starting --user-only.`,
    );
  }
}

async function waitForRunningDiscordStatus(
  waitMs: number,
): Promise<StatusResponse | null> {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const status = await probeDiscordDaemonStatus();
    if (status !== null) {
      return status;
    }
    await Bun.sleep(150);
  }
  return null;
}

async function attachIfRunning(options: {
  passwordLogin: boolean;
  userOnly: boolean;
}): Promise<StatusResponse | null> {
  const immediate = await probeDiscordDaemonStatus();
  if (immediate !== null) {
    assertCompatibleRunningDaemon(immediate, options);
    return immediate;
  }
  const existing = await readDiscordDaemonState();
  if (
    existing !== null &&
    (await daemonRunning(existing.pid, DISCORD_DAEMON_MARKER))
  ) {
    const settled = await waitForRunningDiscordStatus(5000);
    if (settled !== null) {
      assertCompatibleRunningDaemon(settled, options);
      return settled;
    }
  }
  return null;
}

export async function awaitDiscordDaemonReady(
  exitCode: () => number | null,
  timeoutMs: number = STARTUP_TIMEOUT_MS,
): Promise<StatusResponse> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await Bun.sleep(300);
    const code = exitCode();
    if (code !== null) {
      throw new Error(
        `Daemon exited early with code ${String(code)}. Logs: ${discordDaemonLogPath()}`,
      );
    }
    try {
      const status = await probeDiscordDaemonStatus();
      if (status !== null) {
        return status;
      }
    } catch {
      // Socket exists or returned non-200 while starting up; keep polling.
    }
  }
  throw new Error(
    `Daemon did not become ready in ${String(Math.round(timeoutMs / 1000))}s. Logs: ${discordDaemonLogPath()}`,
  );
}

/**
 * Serializes concurrent Discord daemon starts across CLI processes, cleans up
 * dead stale `daemon.sock` / `state.json` files from prior crashes, kills
 * wedged children on timeout, and attaches when a sibling caller started it.
 */
export function ensureDiscordDaemon(
  options: {
    ttlSeconds?: number;
    passwordLogin?: boolean;
    userOnly?: boolean;
  } = {},
): Promise<{ status: StatusResponse; started: boolean }> {
  const ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const passwordLogin = options.passwordLogin === true;
  const userOnly = options.userOnly === true;
  if (passwordLogin && userOnly) {
    return Promise.reject(
      new Error("Choose --password-login or --user-only, not both"),
    );
  }

  return withDaemonStartLock(
    { lockPath: START_LOCK_PATH, timeoutMs: STARTUP_TIMEOUT_MS + 5000 },
    async () => {
      const attached = await attachIfRunning({ passwordLogin, userOnly });
      if (attached !== null) {
        return { status: attached, started: false };
      }

      const env = discordDaemonEnvironment(Bun.env, {
        passwordLogin,
        userOnly,
      });
      env["TOOLKIT_DISCORD_TTL_SECONDS"] = String(ttlSeconds);
      assertDaemonCredentials(passwordLogin, userOnly);

      await mkdir(LOGS_DIR, { recursive: true });
      await rm(SOCKET_PATH, { force: true });
      await rm(STATE_PATH, { force: true });

      const [command, ...args] = serveArgv(passwordLogin, userOnly);
      if (command === undefined) {
        throw new Error("could not determine daemon command");
      }

      // Detached + stdio ignore: the daemon writes its own logs to LOGS_DIR.
      const child = spawn(command, args, {
        detached: true,
        stdio: "ignore",
        env,
      });

      try {
        const status = await awaitDiscordDaemonReady(() => child.exitCode);
        return { status, started: true };
      } catch (error) {
        if (child.exitCode === null) {
          await terminateDaemonChild(child.pid, { graceMs: 2000 });
        }
        await rm(SOCKET_PATH, { force: true });
        await rm(STATE_PATH, { force: true });
        throw error;
      } finally {
        child.unref();
      }
    },
  );
}

export async function stopDiscordDaemon(): Promise<void> {
  const state = await readDiscordDaemonState();
  let statusPid: number | undefined;
  const status = await probeDiscordDaemonStatus().catch(() => null);
  if (status !== null) {
    statusPid = status.pid;
    try {
      await fetch("http://daemon/shutdown", {
        unix: SOCKET_PATH,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // A dead or closing socket: fall through to identity-checked PID stop.
    }
  }
  await stopDaemonPid(state?.pid ?? null, {
    statusPid,
    marker: DISCORD_DAEMON_MARKER,
    waitMs: 5000,
  });
  await rm(SOCKET_PATH, { force: true });
  await rm(STATE_PATH, { force: true });
}
