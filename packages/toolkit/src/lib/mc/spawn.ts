import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  DaemonStateSchema,
  type DaemonState,
  type StatusResponse,
  StatusResponseSchema,
} from "@shepherdjerred/mc-harness/protocol/ipc.ts";
import {
  DAEMON_ENTRY,
  DEFAULT_DAEMON_TTL_SECONDS,
  LOGS_DIR,
  SOCKET_PATH,
  STATE_PATH,
} from "@shepherdjerred/mc-harness/protocol/paths.ts";
import { PROTOCOL_VERSION } from "@shepherdjerred/mc-harness/protocol/version.ts";
import {
  daemonRunning,
  pathExists,
  stopDaemonPid,
  terminateDaemonChild,
  withDaemonStartLock,
} from "@shepherdjerred/unix-socket-daemon";
import { repoRoot } from "#lib/deployed/git.ts";

const START_LOCK_PATH = `${SOCKET_PATH}.lock`;
const STARTUP_TIMEOUT_MS = 30_000;

export async function readDaemonState(): Promise<DaemonState | null> {
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

export function daemonLogPath(): string {
  const day = new Date().toISOString().slice(0, 10);
  return path.join(LOGS_DIR, `daemon-${day}.log`);
}

/** Fails when the running daemon speaks a different IPC version than this CLI. */
export function assertProtocol(status: StatusResponse): void {
  if (status.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error(
      `mc daemon speaks protocol ${String(status.protocolVersion)} but this toolkit speaks ${String(PROTOCOL_VERSION)}. Restart the daemon (toolkit mc daemon stop && toolkit mc daemon start) or reinstall toolkit.`,
    );
  }
}

/**
 * Probes `/status` directly over `SOCKET_PATH` without triggering auto-start.
 * Returns `null` when the socket is absent or refuses connection.
 */
export async function probeMcDaemonStatus(): Promise<StatusResponse | null> {
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
      `mc daemon status failed (HTTP ${String(response.status)})`,
    );
  }
  return StatusResponseSchema.parse(await response.json());
}

/** Removes leftover `daemon.sock` / `state.json` when no live daemon owns them. */
export async function cleanDeadMcDaemonFiles(): Promise<boolean> {
  const state = await readDaemonState();
  if (state !== null && (await daemonRunning(state.pid, DAEMON_ENTRY))) {
    return false;
  }
  if ((await probeMcDaemonStatus()) !== null) {
    return false;
  }
  await rm(SOCKET_PATH, { force: true });
  await rm(STATE_PATH, { force: true });
  return true;
}

async function waitForRunningDaemonStatus(
  waitMs: number,
): Promise<StatusResponse | null> {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const status = await probeMcDaemonStatus();
    if (status !== null) {
      return status;
    }
    await Bun.sleep(150);
  }
  return null;
}

async function attachIfRunning(): Promise<StatusResponse | null> {
  const immediate = await probeMcDaemonStatus();
  if (immediate !== null) {
    assertProtocol(immediate);
    return immediate;
  }
  const existing = await readDaemonState();
  if (existing !== null && (await daemonRunning(existing.pid, DAEMON_ENTRY))) {
    const settled = await waitForRunningDaemonStatus(5000);
    if (settled !== null) {
      assertProtocol(settled);
      return settled;
    }
  }
  return null;
}

/**
 * Serializes concurrent daemon starts across CLI processes, cleans up dead
 * stale `daemon.sock` / `state.json` files from prior crashes, and attaches
 * when a sibling caller already started the daemon.
 */
export function ensureMcDaemon(
  ttlSeconds: number = DEFAULT_DAEMON_TTL_SECONDS,
): Promise<{ status: StatusResponse; started: boolean }> {
  return withDaemonStartLock(
    { lockPath: START_LOCK_PATH, timeoutMs: STARTUP_TIMEOUT_MS + 5000 },
    async () => {
      const attached = await attachIfRunning();
      if (attached !== null) {
        return { status: attached, started: false };
      }

      const root = await repoRoot();
      if (root === null) {
        throw new Error("toolkit mc must run inside the monorepo checkout.");
      }
      const entry = path.join(root, DAEMON_ENTRY);
      if (!(await Bun.file(entry).exists())) {
        throw new Error(`mc daemon entry not found at ${entry}`);
      }
      const bun = Bun.which("bun");
      if (bun === null) {
        throw new Error("bun is required on PATH to run the mc daemon.");
      }

      await mkdir(LOGS_DIR, { recursive: true });
      await rm(SOCKET_PATH, { force: true });
      await rm(STATE_PATH, { force: true });

      // Pipe stderr to capture startup diagnostics until the daemon is ready or exits.
      const child = spawn(bun, ["run", entry], {
        cwd: root,
        detached: true,
        stdio: ["ignore", "ignore", "pipe"],
        env: {
          ...Bun.env,
          OP_SERVICE_ACCOUNT_TOKEN: undefined,
          TOOLKIT_MC_TTL_SECONDS: String(ttlSeconds),
        },
      });

      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      try {
        const status = await awaitDaemonReady(
          () => child.exitCode,
          () => stderr,
        );
        assertProtocol(status);
        return { status, started: true };
      } catch (error) {
        if (child.exitCode === null) {
          await terminateDaemonChild(child.pid, { graceMs: 2000 });
        }
        await rm(SOCKET_PATH, { force: true });
        await rm(STATE_PATH, { force: true });
        throw error;
      } finally {
        child.stderr.destroy();
        child.unref();
      }
    },
  );
}

/**
 * Starts the daemon from the repository source (or attaches if a concurrent
 * caller just started a healthy daemon on this checkout).
 */
export async function startMcDaemon(
  ttlSeconds: number,
): Promise<StatusResponse> {
  const { status } = await ensureMcDaemon(ttlSeconds);
  return status;
}

export async function awaitDaemonReady(
  exitCode: () => number | null,
  getStderr: () => string = () => "",
  timeoutMs: number = STARTUP_TIMEOUT_MS,
): Promise<StatusResponse> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await Bun.sleep(300);
    const code = exitCode();
    if (code !== null) {
      const stderr = getStderr();
      throw new Error(
        `mc daemon exited early with code ${String(code)}: ${stderr.trim() || `Logs: ${daemonLogPath()}`}`,
      );
    }
    try {
      const status = await probeMcDaemonStatus();
      if (status !== null) {
        return status;
      }
    } catch {
      // Socket exists or returned non-200 while starting up; keep polling.
    }
  }
  throw new Error(
    `mc daemon did not become ready in ${String(Math.round(timeoutMs / 1000))}s. Logs: ${daemonLogPath()}`,
  );
}

export async function stopMcDaemon(): Promise<void> {
  const state = await readDaemonState();
  let statusPid: number | undefined;
  const status = await probeMcDaemonStatus().catch(() => null);
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
      // Dead or closing socket: fall through to identity-checked PID stop.
    }
  }
  // Shutdown removes non-kept sandboxes first, which takes a few seconds.
  await stopDaemonPid(state?.pid ?? null, {
    statusPid,
    marker: DAEMON_ENTRY,
    waitMs: 30_000,
  });
  await rm(SOCKET_PATH, { force: true });
  await rm(STATE_PATH, { force: true });
}
