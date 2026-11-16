import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const OWNER_FILENAME = "owner.pid";
const UNINITIALIZED_LOCK_GRACE_MS = 2000;
const GUARD_WAIT_MS = 5000;
const GUARD_REAP_STALE_MS = 5000;

type LockOwnerRecord = {
  pid: number;
  timestamp: number;
  token: string | undefined;
  identity: string | undefined;
};

export type DaemonStartLockOptions = {
  lockPath: string;
  /** Default wait budget baseline (ms). Defaults to 60_000. */
  timeoutMs?: number;
  /** Grace threshold (ms) for abandoned uninitialized lock directories. Defaults to `timeoutMs`. */
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

function isContentionError(error: unknown): boolean {
  return (
    isErrorCode(error, "EEXIST") ||
    isErrorCode(error, "ENOTEMPTY") ||
    isErrorCode(error, "ENOTDIR")
  );
}

async function readProcessIdentity(pid: number): Promise<string | null> {
  if (!pidIsAlive(pid)) {
    return null;
  }
  if (process.platform === "linux") {
    try {
      const statRaw = await readFile(`/proc/${String(pid)}/stat`, "utf8");
      const closeParen = statRaw.lastIndexOf(")");
      if (closeParen === -1) {
        return null;
      }
      const startTicks = statRaw.slice(closeParen + 2).split(" ")[19] ?? "";
      return startTicks.length > 0 ? `${String(pid)}:${startTicks}` : null;
    } catch {
      return null;
    }
  }
  const ps = Bun.spawn(["ps", "-o", "lstart=,command=", "-p", String(pid)], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const [out, code] = await Promise.all([
    new Response(ps.stdout).text(),
    ps.exited,
  ]);
  const signature = out.trim();
  return code === 0 && signature.length > 0
    ? `${String(pid)}:${signature}`
    : null;
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
  return { pid, timestamp, token: lines[2], identity: undefined };
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
  let identity: string | undefined;
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
    } else if (key === "identity" && typeof value === "string") {
      identity = value;
    }
  }
  return pid === undefined || pid <= 0
    ? null
    : { pid, timestamp, token, identity };
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

async function isOwnerProcessAlive(owner: LockOwnerRecord): Promise<boolean> {
  return (
    pidIsAlive(owner.pid) &&
    (owner.identity === undefined ||
      (await readProcessIdentity(owner.pid)) === owner.identity)
  );
}

async function isOwnerStale(
  inspection: Awaited<ReturnType<typeof readLockOwner>>,
  staleMs: number,
): Promise<boolean> {
  if (inspection.state === "missing-dir") {
    return false;
  }
  return inspection.state === "initializing"
    ? inspection.ageMs > Math.min(staleMs, UNINITIALIZED_LOCK_GRACE_MS)
    : !(await isOwnerProcessAlive(inspection.owner));
}

async function publishPopulatedDir(
  targetPath: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const stagePath = `${targetPath}.init-${randomUUID()}`;
  await mkdir(stagePath, { mode: 0o700 });
  try {
    await writeFile(
      path.join(stagePath, OWNER_FILENAME),
      JSON.stringify(payload),
      { mode: 0o600 },
    );
    await rename(stagePath, targetPath);
    return true;
  } catch (error) {
    await rm(stagePath, { recursive: true, force: true });
    if (isContentionError(error)) {
      return false;
    }
    throw error;
  }
}

async function reapDeadGuard(guardPath: string): Promise<void> {
  const reapPath = `${guardPath}.reap`;
  try {
    const reapStat = await stat(reapPath);
    if (Date.now() - reapStat.mtimeMs > GUARD_REAP_STALE_MS) {
      await rm(reapPath, { recursive: true, force: true });
    }
  } catch {
    // Reap lock absent.
  }
  try {
    await mkdir(reapPath, { mode: 0o700 });
  } catch (error) {
    if (isContentionError(error)) {
      return;
    }
    throw error;
  }
  try {
    const guardInspection = await readLockOwner(guardPath);
    if (!(await isOwnerStale(guardInspection, UNINITIALIZED_LOCK_GRACE_MS))) {
      return;
    }
    const deadGuard = `${guardPath}.dead-${randomUUID()}`;
    try {
      await rename(guardPath, deadGuard);
    } catch (error) {
      if (isErrorCode(error, "ENOENT")) {
        return;
      }
      throw error;
    }
    await rm(deadGuard, { recursive: true, force: true });
  } finally {
    await rm(reapPath, { recursive: true, force: true });
  }
}

async function releaseGuardIfOwned(
  guardPath: string,
  guardToken: string,
): Promise<void> {
  const current = await readLockOwner(guardPath);
  if (current.state !== "owned" || current.owner.token !== guardToken) {
    return;
  }
  const doneGuard = `${guardPath}.done-${guardToken}`;
  try {
    await rename(guardPath, doneGuard);
    await rm(doneGuard, { recursive: true, force: true });
  } catch {
    // Already removed.
  }
}

async function withLockGuard<T>(
  lockPath: string,
  selfIdentity: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  const guardPath = `${lockPath}.guard`;
  const guardToken = randomUUID();
  const deadline = Date.now() + GUARD_WAIT_MS;
  while (Date.now() <= deadline) {
    const acquired = await publishPopulatedDir(guardPath, {
      pid: process.pid,
      timestamp: Date.now(),
      token: guardToken,
      ...(selfIdentity === null ? {} : { identity: selfIdentity }),
    });
    if (acquired) {
      try {
        return await fn();
      } finally {
        await releaseGuardIfOwned(guardPath, guardToken);
      }
    }
    await reapDeadGuard(guardPath);
    await Bun.sleep(10);
  }
  throw new Error(`Timed out waiting for lock metadata guard at ${guardPath}`);
}

async function tryAcquireOwnedLock(
  lockPath: string,
  selfIdentity: string | null,
): Promise<string | null> {
  const token = randomUUID();
  return withLockGuard(lockPath, selfIdentity, async () => {
    const existing = await readLockOwner(lockPath);
    if (existing.state !== "missing-dir") {
      return null;
    }
    const published = await publishPopulatedDir(lockPath, {
      pid: process.pid,
      timestamp: Date.now(),
      token,
      ...(selfIdentity === null ? {} : { identity: selfIdentity }),
    });
    return published ? token : null;
  });
}

async function tryBreakStaleLock(
  lockPath: string,
  staleMs: number,
  expectedToken: string | undefined,
  selfIdentity: string | null,
): Promise<void> {
  let displaced: string | undefined;
  await withLockGuard(lockPath, selfIdentity, async () => {
    const rechecked = await readLockOwner(lockPath);
    if (!(await isOwnerStale(rechecked, staleMs))) {
      return;
    }
    if (
      expectedToken !== undefined &&
      rechecked.state === "owned" &&
      rechecked.owner.token !== expectedToken
    ) {
      return;
    }
    const target = `${lockPath}.stale-${randomUUID()}`;
    try {
      await rename(lockPath, target);
      displaced = target;
    } catch (error) {
      if (!isErrorCode(error, "ENOENT")) {
        throw error;
      }
    }
  });
  if (displaced !== undefined) {
    await rm(displaced, { recursive: true, force: true });
  }
}

async function releaseOwnedLock(
  lockPath: string,
  token: string,
  selfIdentity: string | null,
): Promise<void> {
  let retiring: string | undefined;
  await withLockGuard(lockPath, selfIdentity, async () => {
    const current = await readLockOwner(lockPath);
    if (current.state !== "owned" || current.owner.token !== token) {
      return;
    }
    const target = `${lockPath}.done-${token}`;
    try {
      await rename(lockPath, target);
      retiring = target;
    } catch (error) {
      if (!isErrorCode(error, "ENOENT")) {
        throw error;
      }
    }
  });
  if (retiring !== undefined) {
    await rm(retiring, { recursive: true, force: true });
  }
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
  const selfIdentity = await readProcessIdentity(process.pid);

  const deadline = Date.now() + waitMs;
  while (Date.now() <= deadline) {
    const token = await tryAcquireOwnedLock(lockPath, selfIdentity);
    if (token !== null) {
      try {
        return await fn();
      } finally {
        await releaseOwnedLock(lockPath, token, selfIdentity);
      }
    }

    const inspection = await readLockOwner(lockPath);
    if (await isOwnerStale(inspection, staleMs)) {
      const expectedToken =
        inspection.state === "owned" ? inspection.owner.token : undefined;
      await tryBreakStaleLock(lockPath, staleMs, expectedToken, selfIdentity);
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
