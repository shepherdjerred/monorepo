import { lstat, readdir, rm } from "node:fs/promises";
import nodePath from "node:path";
const { join } = nodePath;

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const TARGET_BYTES = 8 * 1024 ** 3;

async function directoryBytes(directory: string): Promise<number> {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error("Source cache GC refuses symlinks");
    const info = await lstat(path);
    bytes += entry.isDirectory() ? await directoryBytes(path) : info.size;
  }
  return bytes;
}

async function versionExists(version: string): Promise<boolean> {
  // A newly mounted claim has no v1 directory until its first cache write.
  try {
    const info = await lstat(version);
    if (!info.isDirectory())
      throw new Error("Invalid source cache version directory");
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

export async function collectSourceCache(
  root: string,
  now = Date.now(),
  targetBytes = TARGET_BYTES,
) {
  const version = join(root, "v1");
  if (!(await versionExists(version))) return { removed: 0, retainedBytes: 0 };
  const candidates: { path: string; touched: number; bytes: number }[] = [];
  for (const repo of await readdir(version, { withFileTypes: true })) {
    if (!repo.isDirectory() || !/^[a-f\d]{64}$/u.test(repo.name))
      throw new Error("Unexpected source cache repository directory");
    for (const entry of await readdir(join(version, repo.name), {
      withFileTypes: true,
    })) {
      if (
        !entry.isDirectory() ||
        !/^[a-f\d]{40}(?:\.tmp-[a-f\d-]{36})?$/u.test(entry.name)
      )
        throw new Error("Unexpected source cache snapshot directory");
      const path = join(version, repo.name, entry.name);
      const info = await lstat(path);
      candidates.push({
        path,
        touched: info.mtimeMs,
        bytes: await directoryBytes(path),
      });
    }
  }
  let retainedBytes = candidates.reduce(
    (total, entry) => total + entry.bytes,
    0,
  );
  let removed = 0;
  for (const entry of candidates.toSorted((a, b) => a.touched - b.touched)) {
    if (now - entry.touched < RETENTION_MS && retainedBytes <= targetBytes)
      continue;
    await rm(entry.path, { recursive: true });
    retainedBytes -= entry.bytes;
    removed++;
  }
  return { removed, retainedBytes };
}

// The Temporal activity invokes this under the same exclusive GC lock that
// trusted clones hold shared. Never unlink the lock or collect an active copy.
if (import.meta.main) {
  for (const root of ["/woodpecker/source-main", "/woodpecker/source-pr"]) {
    console.log(JSON.stringify({ root, ...(await collectSourceCache(root)) }));
  }
}
