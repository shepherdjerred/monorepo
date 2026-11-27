import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { SNAPSHOT_V2_DIRECTORY } from "@scout-for-lol/data/meta/snapshot-v2-budget.ts";
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

export async function readSnapshotDirectory(
  directory: string,
): Promise<Map<string, string>> {
  assertSnapshotDirectory(directory);
  const files = new Map<string, string>();
  const glob = new Bun.Glob("**/*.json");
  for await (const relative of glob.scan({ cwd: directory })) {
    files.set(relative, await Bun.file(path.join(directory, relative)).text());
  }
  return files;
}
