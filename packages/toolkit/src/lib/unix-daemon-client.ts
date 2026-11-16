import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  daemonRunning,
  pathExists,
  stopDaemonPid,
  terminateDaemonChild,
} from "@shepherdjerred/unix-socket-daemon";

export function dailyDaemonLogPath(logsDir: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return path.join(logsDir, `daemon-${day}.log`);
}

export async function readDaemonStateFile<T>(
  statePath: string,
  parse: (raw: unknown) => T | null,
): Promise<T | null> {
  if (!(await pathExists(statePath))) {
    return null;
  }
  try {
    const raw: unknown = JSON.parse(await readFile(statePath, "utf8"));
    return parse(raw);
  } catch {
    return null;
  }
}

export async function probeUnixDaemonStatus<T>(options: {
  socketPath: string;
  label: string;
  parse: (raw: unknown) => T;
  timeoutMs?: number;
}): Promise<T | null> {
  if (!(await pathExists(options.socketPath))) {
    return null;
  }
  let response: Response;
  try {
    response = await fetch("http://daemon/status", {
      unix: options.socketPath,
      signal: AbortSignal.timeout(options.timeoutMs ?? 3000),
    });
  } catch {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `${options.label} status failed (HTTP ${String(response.status)})`,
    );
  }
  return options.parse(await response.json());
}

export async function cleanDeadDaemonFiles<
  TState extends { pid: number },
>(options: {
  socketPath: string;
  statePath: string;
  marker: string;
  readState: () => Promise<TState | null>;
  probeStatus: () => Promise<unknown>;
}): Promise<boolean> {
  const state = await options.readState();
  if (state !== null && (await daemonRunning(state.pid, options.marker))) {
    return false;
  }
  if ((await options.probeStatus()) !== null) {
    return false;
  }
  await rm(options.socketPath, { force: true });
  await rm(options.statePath, { force: true });
  return true;
}

export async function attachRunningDaemon<
  TStatus,
  TState extends { pid: number },
>(options: {
  marker: string;
  readState: () => Promise<TState | null>;
  probeStatus: () => Promise<TStatus | null>;
  validate?: (status: TStatus) => void;
  settleMs?: number;
}): Promise<TStatus | null> {
  const immediate = await options.probeStatus();
  if (immediate !== null) {
    options.validate?.(immediate);
    return immediate;
  }
  const existing = await options.readState();
  if (
    existing !== null &&
    (await daemonRunning(existing.pid, options.marker))
  ) {
    const deadline = Date.now() + (options.settleMs ?? 5000);
    while (Date.now() < deadline) {
      const settled = await options.probeStatus();
      if (settled !== null) {
        options.validate?.(settled);
        return settled;
      }
      await Bun.sleep(150);
    }
  }
  return null;
}

export async function cleanupFailedDaemonStart(options: {
  pid: number | undefined;
  exitCode: number | null;
  socketPath: string;
  statePath: string;
  graceMs?: number;
}): Promise<void> {
  if (options.exitCode === null) {
    await terminateDaemonChild(options.pid, {
      graceMs: options.graceMs ?? 2000,
    });
  }
  await rm(options.socketPath, { force: true });
  await rm(options.statePath, { force: true });
}

export async function shutdownUnixDaemon<
  TStatus extends { pid: number },
  TState extends { pid: number },
>(options: {
  socketPath: string;
  statePath: string;
  marker: string;
  waitMs: number;
  readState: () => Promise<TState | null>;
  probeStatus: () => Promise<TStatus | null>;
}): Promise<void> {
  const state = await options.readState();
  let statusPid: number | undefined;
  const status = await options.probeStatus().catch(() => null);
  if (status !== null) {
    statusPid = status.pid;
    try {
      await fetch("http://daemon/shutdown", {
        unix: options.socketPath,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // Dead or closing socket: fall through to identity-checked PID stop.
    }
  }
  await stopDaemonPid(state?.pid ?? null, {
    statusPid,
    marker: options.marker,
    waitMs: options.waitMs,
  });
  await rm(options.socketPath, { force: true });
  await rm(options.statePath, { force: true });
}
