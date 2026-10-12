import { randomUUID } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import path from "node:path";

/**
 * Durably replace `target` with `data`: write a uniquely named temp file in the same
 * directory, fsync it, rename it over `target`, then fsync the directory so the rename
 * itself survives a crash. A reader (or a crash at any point) sees either the old file
 * or the complete new one, never a truncated mix — the property every per-guild save
 * depends on.
 *
 * Concurrent writers to the same target each use their own temp file, so the last
 * rename wins with a complete file rather than interleaving bytes.
 */
export async function writeFileAtomic(
  target: string,
  data: string | Uint8Array,
): Promise<void> {
  const dir = path.dirname(target);
  const temp = path.join(dir, `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    const handle = await open(temp, "wx");
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  await fsyncDirectory(dir);
}

/** fsync a directory so a rename or create inside it is durable. */
export async function fsyncDirectory(dir: string): Promise<void> {
  const handle = await open(dir, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
