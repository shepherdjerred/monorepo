import { mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";

/**
 * A pid lock so a scheduled run that overlaps a long backfill exits instead
 * of racing it. A lock left by a process that no longer exists is taken over.
 */
export type SyncLock = { release: () => Promise<void> };

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    // EPERM means the pid exists but belongs to someone else.
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

async function tryCreate(file: string): Promise<boolean> {
  try {
    const handle = await open(file, "wx", 0o600);
    await handle.writeFile(String(process.pid));
    await handle.close();
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      return false;
    }
    throw error;
  }
}

/** Resolves `null` when another live process holds the lock. */
export async function acquireSyncLock(file: string): Promise<SyncLock | null> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  if (!(await tryCreate(file))) {
    const holder = Number.parseInt(await readFile(file, "utf8"), 10);
    if (Number.isInteger(holder) && holder > 0 && processAlive(holder)) {
      return null;
    }
    await rm(file, { force: true });
    if (!(await tryCreate(file))) return null;
  }
  return {
    release: async () => {
      await rm(file, { force: true });
    },
  };
}
