import { cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fsyncDirectory } from "@shepherdjerred/discord-stream-lifecycle/persistence/atomic-write";

/** Directory under each guild's session dir that holds point-in-time save copies. */
export const SAVE_HISTORY_DIR = "history";

export type SaveHistoryOptions = {
  /**
   * Save files or directories, relative to the session dir, that make up the guild's
   * progress. Missing entries are skipped (a guild's first session has no saves yet).
   */
  readonly entries: readonly string[];
  /** Number of snapshots to keep per guild; older ones are pruned. */
  readonly keep: number;
  readonly now?: () => Date;
};

const SNAPSHOT_NAME = /^\d{8}T\d{9}Z$/;

/**
 * Copy the guild's save entries into `<sessionDir>/history/<timestamp>/` and prune to the
 * newest `keep` snapshots. Called before a session boots, so every session's starting
 * state can be restored if the session corrupts or overwrites progress — finer-grained
 * than the volume backups, and per guild.
 *
 * The copy is assembled in a hidden staging dir and renamed into place, so a crash
 * never leaves a partial snapshot that looks complete. Returns the snapshot path, or
 * null when the guild has no saves yet.
 */
export async function snapshotSaveDir(
  sessionDir: string,
  options: SaveHistoryOptions,
): Promise<string | null> {
  if (!Number.isInteger(options.keep) || options.keep < 1) {
    throw new Error(
      `save history keep must be >= 1, got ${String(options.keep)}`,
    );
  }
  const present: string[] = [];
  for (const entry of options.entries) {
    const source = resolveEntry(sessionDir, entry);
    if (await exists(source)) {
      present.push(entry);
    }
  }
  if (present.length === 0) {
    return null;
  }
  const historyDir = path.join(sessionDir, SAVE_HISTORY_DIR);
  await mkdir(historyDir, { recursive: true });
  const name = snapshotName((options.now ?? (() => new Date()))());
  const finalDir = path.join(historyDir, name);
  const stagingDir = path.join(historyDir, `.staging-${name}`);
  await rm(stagingDir, { recursive: true, force: true });
  try {
    for (const entry of present) {
      await cp(resolveEntry(sessionDir, entry), path.join(stagingDir, entry), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    }
    await rename(stagingDir, finalDir);
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
  await fsyncDirectory(historyDir);
  await pruneSnapshots(historyDir, options.keep);
  return finalDir;
}

/** Snapshot names sort chronologically: `20261011T183931123Z`. */
function snapshotName(date: Date): string {
  return date.toISOString().replaceAll(/[-:.]/g, "");
}

async function pruneSnapshots(historyDir: string, keep: number): Promise<void> {
  const names = await readdir(historyDir);
  const snapshots = names.filter((name) => SNAPSHOT_NAME.test(name)).toSorted();
  for (const name of snapshots.slice(0, Math.max(0, snapshots.length - keep))) {
    await rm(path.join(historyDir, name), { recursive: true, force: true });
  }
}

function resolveEntry(sessionDir: string, entry: string): string {
  const resolved = path.resolve(sessionDir, entry);
  const relative = path.relative(sessionDir, resolved);
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    relative.split(path.sep)[0] === SAVE_HISTORY_DIR
  ) {
    throw new Error(
      `save history entry must be inside the session dir: ${JSON.stringify(entry)}`,
    );
  }
  return resolved;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
