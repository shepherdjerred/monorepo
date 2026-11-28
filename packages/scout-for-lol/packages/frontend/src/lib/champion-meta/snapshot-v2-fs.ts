import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  SNAPSHOT_V2_DIRECTORY,
  SNAPSHOT_V2_GUARD_HINT,
  SNAPSHOT_V2_GUARD_MARKER,
  SNAPSHOT_V2_MAX_CHANGED_FILES,
} from "@scout-for-lol/data/meta/snapshot-v2-budget.ts";
import type { SnapshotTexts } from "./snapshot-v2-files.ts";

/**
 * Write and read the committed snapshot directory. The directory is replaced
 * wholesale, so a matchup the API no longer lists does not linger.
 */

const SNAPSHOT_DIRECTORY_NAME = path.basename(SNAPSHOT_V2_DIRECTORY);

/** The directory name is checked before anything under it is removed. */
function assertSnapshotDirectory(directory: string): void {
  if (
    !path.isAbsolute(directory) ||
    path.basename(directory) !== SNAPSHOT_DIRECTORY_NAME
  ) {
    throw new Error(
      `Refusing to replace ${directory}: expected an absolute path ending in ${SNAPSHOT_DIRECTORY_NAME}`,
    );
  }
}

export async function writeSnapshotDirectory(
  directory: string,
  files: SnapshotTexts,
): Promise<void> {
  assertSnapshotDirectory(directory);
  await rm(directory, { recursive: true, force: true });
  for (const [relative, content] of files) {
    const target = path.join(directory, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await Bun.write(target, content);
  }
}

/** The directory's JSON files; a directory that does not exist yet holds none. */
export async function readSnapshotDirectory(
  directory: string,
): Promise<Map<string, string>> {
  assertSnapshotDirectory(directory);
  const files = new Map<string, string>();
  try {
    await readdir(directory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return files;
    }
    throw error;
  }
  const glob = new Bun.Glob("**/*.json");
  for await (const relative of glob.scan({ cwd: directory })) {
    files.set(relative, await Bun.file(path.join(directory, relative)).text());
  }
  return files;
}

export type SnapshotChangeSet = {
  added: string[];
  modified: string[];
  removed: string[];
};

/** What replacing the files in `existing` with `next` adds, rewrites and removes. */
export function snapshotChangeSet(
  existing: SnapshotTexts,
  next: SnapshotTexts,
): SnapshotChangeSet {
  const changes: SnapshotChangeSet = { added: [], modified: [], removed: [] };
  for (const [relative, content] of next) {
    const before = existing.get(relative);
    if (before === undefined) changes.added.push(relative);
    else if (before !== content) changes.modified.push(relative);
  }
  for (const relative of existing.keys()) {
    if (!next.has(relative)) changes.removed.push(relative);
  }
  return changes;
}

export function changedFileCount(changes: SnapshotChangeSet): number {
  return (
    changes.added.length + changes.modified.length + changes.removed.length
  );
}

/** A refresh that would change more files than a pull request can carry fails, never truncates. */
export function assertChangeSetWithinLimit(
  changes: SnapshotChangeSet,
  limit: number = SNAPSHOT_V2_MAX_CHANGED_FILES,
): void {
  const count = changedFileCount(changes);
  if (count > limit) {
    throw new Error(
      `Champion meta snapshot refresh would change ${count.toString()} files (${changes.added.length.toString()} added, ${changes.modified.length.toString()} rewritten, ${changes.removed.length.toString()} removed), over the limit of ${limit.toString()} a pull request can carry.\n${SNAPSHOT_V2_GUARD_MARKER}: ${SNAPSHOT_V2_GUARD_HINT}`,
    );
  }
}

/**
 * Replace the committed snapshot directory with `files`, after checking the
 * change set against `limit` (the production limit unless a caller passes
 * another, as tests do). The limit is checked before anything is removed, so
 * a refused refresh leaves the directory as it was.
 */
export async function refreshSnapshotDirectory(
  directory: string,
  files: SnapshotTexts,
  limit: number = SNAPSHOT_V2_MAX_CHANGED_FILES,
): Promise<SnapshotChangeSet> {
  const changes = snapshotChangeSet(
    await readSnapshotDirectory(directory),
    files,
  );
  assertChangeSetWithinLimit(changes, limit);
  await writeSnapshotDirectory(directory, files);
  return changes;
}
