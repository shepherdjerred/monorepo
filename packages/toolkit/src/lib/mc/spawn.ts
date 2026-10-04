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
  LOGS_DIR,
  SOCKET_PATH,
  STATE_PATH,
} from "@shepherdjerred/mc-harness/protocol/paths.ts";
import { PROTOCOL_VERSION } from "@shepherdjerred/mc-harness/protocol/version.ts";
import {
  daemonRunning,
  pathExists,
  stopDaemonPid,
} from "@shepherdjerred/unix-socket-daemon";
import { repoRoot } from "#lib/deployed/git.ts";
import { daemonRequest } from "#lib/mc/client.ts";

export async function readDaemonState(): Promise<DaemonState | null> {
  if (!(await pathExists(STATE_PATH))) {
    return null;
  }
  const raw: unknown = JSON.parse(await Bun.file(STATE_PATH).text());
  return DaemonStateSchema.parse(raw);
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
 * Starts the daemon from the repository source: it stages the repo-built
 * MCBridge.jar, so it must run where the monorepo is checked out.
 */
export async function startMcDaemon(
  ttlSeconds: number,
): Promise<StatusResponse> {
  const existing = await readDaemonState();
  if (existing !== null && (await daemonRunning(existing.pid, DAEMON_ENTRY))) {
    throw new Error(
      `mc daemon is already running (pid ${String(existing.pid)}). Use 'toolkit mc daemon stop' first.`,
    );
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

  // Detached + stdio ignore: the daemon writes its own logs to LOGS_DIR.
  const child = spawn(bun, ["run", entry], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    env: { ...Bun.env, TOOLKIT_MC_TTL_SECONDS: String(ttlSeconds) },
  });
  child.unref();

  const status = await awaitDaemonReady(() => child.exitCode);
  assertProtocol(status);
  return status;
}

async function awaitDaemonReady(
  exitCode: () => number | null,
): Promise<StatusResponse> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await Bun.sleep(300);
    const code = exitCode();
    if (code !== null) {
      throw new Error(
        `mc daemon exited early with code ${String(code)}. Logs: ${daemonLogPath()}`,
      );
    }
    if (await pathExists(SOCKET_PATH)) {
      try {
        return await daemonRequest(StatusResponseSchema, "GET", "/status");
      } catch {
        // The socket exists but the server is not accepting yet; keep polling.
      }
    }
  }
  throw new Error(
    `mc daemon did not become ready in 30s. Logs: ${daemonLogPath()}`,
  );
}

export async function stopMcDaemon(): Promise<void> {
  const state = await readDaemonState();
  let statusPid: number | undefined;
  if (await pathExists(SOCKET_PATH)) {
    try {
      const status = await daemonRequest(
        StatusResponseSchema,
        "GET",
        "/status",
      );
      statusPid = status.pid;
      await daemonRequest(
        StatusResponseSchema.partial(),
        "POST",
        "/shutdown",
        {},
      );
    } catch {
      // A dead socket: fall through to the identity-checked PID stop.
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
