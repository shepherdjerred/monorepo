import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const OWNER_FILENAME = "owner.pid";
const UNINITIALIZED_LOCK_GRACE_MS = 2000;
const BREAK_LOCK_STALE_MS = 5000;

type LockOwnerRecord = {
  pid: number;
  timestamp: number;
  token: string | undefined;
};

export type DaemonStartLockOptions = {
  lockPath: string;
  /** Startup timeout (ms): locks older than this are treated as wedged and broken. Defaults to 60_000. */
  timeoutMs?: number;
  /** Optional explicit stale threshold override (ms). Defaults to `timeoutMs`. */
  staleMs?: number;
  /** Optional total wait budget (ms) before giving up on acquiring the lock. */
  waitMs?: number;
  pollMs?: number;
};

function pidIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error instanceof Error &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function parsePlainOwnerLines(
  trimmed: string,
  fallbackTimestamp: number,
): LockOwnerRecord | null {
  const lines = trimmed.split(/\s+/u);
  const pid = Number.parseInt(lines[0] ?? "", 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }
  const parsedTs = Number.parseInt(lines[1] ?? "", 10);
  const timestamp =
    Number.isFinite(parsedTs) && parsedTs > 0 ? parsedTs : fallbackTimestamp;
  return { pid, timestamp, token: lines[2] };
}

/** Avoids type assertions (`no-type-assertions` rule): extract fields via `Object.entries`. */
function parseJsonOwnerSafe(
  raw: string,
  fallbackTimestamp: number,
): LockOwnerRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  let pid: number | undefined;
  let timestamp = fallbackTimestamp;
  let token: string | undefined;
  for (const [key, value] of Object.entries(parsed)) {
    if (key === "pid" && typeof value === "number" && Number.isInteger(value)) {
      pid = value;
    } else if (
      key === "timestamp" &&
      typeof value === "number" &&
      Number.isFinite(value)
    ) {
      timestamp = value;
    } else if (key === "token" && typeof value === "string") {
      token = value;
    }
  }
  return pid === undefined || pid <= 0 ? null : { pid, timestamp, token };
}

async function readLockOwner(
  lockPath: string,
): Promise<
  | { state: "missing-dir" }
  | { state: "initializing"; ageMs: number }
  | { state: "owned"; owner: LockOwnerRecord }
> {
  const ownerPath = path.join(lockPath, OWNER_FILENAME);
  try {
    const [raw, ownerStat] = await Promise.all([
      readFile(ownerPath, "utf8"),
      stat(ownerPath),
    ]);
    const trimmed = raw.trim();
    const owner =
      (trimmed.startsWith("{")
        ? parseJsonOwnerSafe(trimmed, ownerStat.mtimeMs)
        : null) ?? parsePlainOwnerLines(trimmed, ownerStat.mtimeMs);
    if (owner !== null) {
      return { state: "owned", owner };
    }
    return {
      state: "initializing",
      ageMs: Math.max(0, Date.now() - ownerStat.mtimeMs),
    };
  } catch (error) {
    if (!isErrorCode(error, "ENOENT")) {
      throw error;
    }
  }

  try {
    const dirStat = await stat(lockPath);
    return {
      state: "initializing",
      ageMs: Math.max(0, Date.now() - dirStat.mtimeMs),
    };
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return { state: "missing-dir" };
    }
    throw error;
  }
}

function isOwnerStale(
  inspection: Awaited<ReturnType<typeof readLockOwner>>,
  staleMs: number,
): boolean {
  if (inspection.state === "missing-dir") {
    return false;
  }
  return inspection.state === "initializing"
    ? inspection.ageMs > Math.min(staleMs, UNINITIALIZED_LOCK_GRACE_MS)
    : !pidIsAlive(inspection.owner.pid) ||
        Date.now() - inspection.owner.timestamp > staleMs;
}

async function tryBreakStaleLock(
  lockPath: string,
  staleMs: number,
  expectedToken: string | undefined,
): Promise<void> {
  const breakGuard = `${lockPath}.breaking`;
  try {
    const guardStat = await stat(breakGuard);
    if (Date.now() - guardStat.mtimeMs > BREAK_LOCK_STALE_MS) {
      await rm(breakGuard, { recursive: true, force: true });
    }
  } catch {
    // Guard does not exist.
  }

  try {
    await mkdir(breakGuard, { mode: 0o700 });
  } catch (error) {
    if (isErrorCode(error, "EEXIST")) {
      return;
    }
    throw error;
  }

  try {
    const rechecked = await readLockOwner(lockPath);
    if (!isOwnerStale(rechecked, staleMs)) {
      return;
    }
    if (
      expectedToken !== undefined &&
      rechecked.state === "owned" &&
      rechecked.owner.token !== expectedToken
    ) {
      return;
    }
    const displaced = `${lockPath}.stale-${randomUUID()}`;
    try {
      await rename(lockPath, displaced);
    } catch (error) {
      if (isErrorCode(error, "ENOENT")) {
        return;
      }
      throw error;
    }
    await rm(displaced, { recursive: true, force: true });
  } finally {
    await rm(breakGuard, { recursive: true, force: true });
  }
}

async function releaseOwnedLock(
  lockPath: string,
  token: string,
): Promise<void> {
  const current = await readLockOwner(lockPath);
  if (current.state !== "owned" || current.owner.token !== token) {
    return;
  }
  const retiring = `${lockPath}.done-${token}`;
  try {
    await rename(lockPath, retiring);
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return;
    }
    throw error;
  }
  await rm(retiring, { recursive: true, force: true });
}

export async function acquireAndRunWithLock<T>(
  options: DaemonStartLockOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const { lockPath } = options;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const staleMs = options.staleMs ?? timeoutMs;
  const waitMs = options.waitMs ?? Math.max(timeoutMs, staleMs) + 5000;
  const pollMs = options.pollMs ?? 50;

  await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });

  const deadline = Date.now() + waitMs;
  while (Date.now() <= deadline) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      const token = randomUUID();
      const ownerPayload = JSON.stringify({
        pid: process.pid,
        timestamp: Date.now(),
        token,
      });
      await writeFile(path.join(lockPath, OWNER_FILENAME), ownerPayload, {
        mode: 0o600,
      });
      try {
        return await fn();
      } finally {
        await releaseOwnedLock(lockPath, token);
      }
    } catch (error) {
      if (!isErrorCode(error, "EEXIST")) {
        throw error;
      }
    }

    const inspection = await readLockOwner(lockPath);
    if (isOwnerStale(inspection, staleMs)) {
      const expectedToken =
        inspection.state === "owned" ? inspection.owner.token : undefined;
      await tryBreakStaleLock(lockPath, staleMs, expectedToken);
      continue;
    }

    await Bun.sleep(pollMs);
  }

  throw new Error(
    `Timed out after ${String(waitMs)}ms waiting for daemon startup lock at ${lockPath}`,
  );
}

function signalProcessOrGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
    return;
  } catch {
    // Process may not be a group leader; signal the PID directly.
  }
  try {
    process.kill(pid, signal);
  } catch {
    // Process already exited.
  }
}

export async function terminateChildPid(
  pid: number | undefined,
  options: { graceMs?: number; pollMs?: number } = {},
): Promise<void> {
  if (pid === undefined || !pidIsAlive(pid)) {
    return;
  }
  const graceMs = options.graceMs ?? 2000;
  const pollMs = options.pollMs ?? 50;

  signalProcessOrGroup(pid, "SIGTERM");
  const termDeadline = Date.now() + graceMs;
  while (Date.now() < termDeadline && pidIsAlive(pid)) {
    await Bun.sleep(pollMs);
  }
  if (!pidIsAlive(pid)) {
    return;
  }

  signalProcessOrGroup(pid, "SIGKILL");
  const killDeadline = Date.now() + 1000;
  while (Date.now() < killDeadline && pidIsAlive(pid)) {
    await Bun.sleep(pollMs);
  }
}
