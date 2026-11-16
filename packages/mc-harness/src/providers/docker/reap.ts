import { rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { instanceDirectory } from "#protocol/instance.ts";
import { SHARED_DIR } from "#protocol/paths.ts";
import { dockerContainerId, type SandboxStore } from "#sandbox/record.ts";
import { docker } from "./docker-cli.ts";
import { SandboxLifecycle } from "./lifecycle.ts";
import {
  LABELS,
  parseExpiresAtMs,
  parseSandboxRows,
  SANDBOX_ROW_FORMAT,
  type SandboxRow,
} from "./rows.ts";

const EpermErrorSchema = z.object({ code: z.literal("EPERM") });

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return EpermErrorSchema.safeParse(error).success;
  }
}

function isExpiredAt(expiresAt: string, nowMs: number): boolean {
  const parsed = parseExpiresAtMs(expiresAt);
  return parsed !== null && parsed <= nowMs;
}

async function removeDockerContainer(containerId: string): Promise<void> {
  if (containerId.length === 0) return;
  try {
    await docker(["rm", "-f", "-v", containerId]);
  } catch (error) {
    if (!(error instanceof Error && error.message.includes("No such"))) {
      throw error;
    }
  }
}

async function defaultListRows(ownerFilter?: string): Promise<SandboxRow[]> {
  const { stdout } = await docker([
    "ps",
    "-a",
    "--filter",
    `label=${LABELS.sandbox}`,
    ...(ownerFilter === undefined
      ? []
      : ["--filter", `label=${LABELS.owner}=${ownerFilter}`]),
    "--format",
    SANDBOX_ROW_FORMAT,
  ]);
  return parseSandboxRows(stdout);
}

function shouldReapLocalCandidate(options: {
  current: SandboxRow[];
  hasRecord: boolean;
  nowMs: number;
  currentDaemonPid: number;
  isAlive: (pid: number) => boolean;
}): boolean {
  const { current, hasRecord, nowMs, currentDaemonPid, isAlive } = options;
  return (
    (hasRecord && current.length === 0) ||
    current.some(
      (row) =>
        row.stale ||
        (!row.keep && isExpiredAt(row.expiresAt, nowMs)) ||
        (!row.keep &&
          row.daemonPid !== null &&
          row.daemonPid !== currentDaemonPid &&
          !isAlive(row.daemonPid)),
    )
  );
}

function shouldReapForeignRow(options: {
  row: SandboxRow;
  baseOwner: string;
  currentOwner: string;
  nowMs: number;
  isAlive: (pid: number) => boolean;
}): string | null {
  const { row, baseOwner, currentOwner, nowMs, isAlive } = options;
  const foreignPrefix = `${baseOwner}:wt-`;
  if (row.owner === currentOwner || !row.owner.startsWith(foreignPrefix)) {
    return null;
  }
  const wtInstance = row.owner.slice(baseOwner.length + 1);
  if (!/^wt-[a-z0-9-]{1,29}$/u.test(wtInstance)) return null;
  return row.keep ||
    !isExpiredAt(row.expiresAt, nowMs) ||
    row.daemonPid === null ||
    isAlive(row.daemonPid)
    ? null
    : wtInstance;
}

export type ReapManagedContainersOptions = {
  now: Date;
  baseOwner: string;
  currentOwner: string;
  store: SandboxStore;
  sharedDir?: string;
  currentDaemonPid?: number;
  isAlive?: (pid: number) => boolean;
  lifecycle?: SandboxLifecycle;
  listRows?: (ownerFilter?: string) => Promise<SandboxRow[]>;
  removeContainer?: (containerId: string) => Promise<void>;
  onDestroyLocal?: (id: string) => void;
};

/**
 * Reaps expired, stale, or dead-daemon containers in the current instance AND
 * expired containers across other `wt-*` worktree instances whose owning daemon PID is dead.
 */
export async function reapManagedContainers(
  options: ReapManagedContainersOptions,
): Promise<string[]> {
  const {
    now,
    baseOwner,
    currentOwner,
    store,
    sharedDir = SHARED_DIR,
    currentDaemonPid = process.pid,
    isAlive = isProcessAlive,
    lifecycle = new SandboxLifecycle(),
    listRows = defaultListRows,
    removeContainer = removeDockerContainer,
    onDestroyLocal,
  } = options;

  const nowMs = now.getTime();
  const reaped = new Set<string>();

  const records = await store.listFor("docker");
  const localRows = await listRows(currentOwner);
  const candidates = new Set([
    ...records.map((record) => record.id),
    ...localRows.map((row) => row.id).filter((id) => id.length > 0),
  ]);
  for (const id of candidates) {
    const removed = await lifecycle.run(id, async () => {
      const record = await store.read(id);
      const inventory = await listRows(currentOwner);
      const current = inventory.filter((row) => row.id === id);
      if (
        !shouldReapLocalCandidate({
          current,
          hasRecord: record !== null,
          nowMs,
          currentDaemonPid,
          isAlive,
        })
      ) {
        return false;
      }
      onDestroyLocal?.(id);
      const containers =
        current.length > 0
          ? current.map((row) => row.containerId)
          : record === null
            ? []
            : [dockerContainerId(record)];
      for (const containerId of containers) {
        await removeContainer(containerId);
      }
      await store.remove(id);
      return true;
    });
    if (removed) reaped.add(id);
  }

  const allRows = await listRows(undefined);
  for (const row of allRows) {
    const wtInstance = shouldReapForeignRow({
      row,
      baseOwner,
      currentOwner,
      nowMs,
      isAlive,
    });
    if (wtInstance === null) continue;
    await removeContainer(row.containerId);
    if (/^sbx-[0-9a-f]{6}$/u.test(row.id)) {
      const foreignSandboxDir = path.join(
        instanceDirectory(sharedDir, wtInstance),
        "sandboxes",
        row.id,
      );
      await rm(foreignSandboxDir, { recursive: true, force: true });
    }
    reaped.add(row.id.length > 0 ? row.id : row.containerId);
  }

  return [...reaped];
}
