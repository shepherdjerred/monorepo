import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import path from "node:path";

/** Publish a complete pack without replacing a cache another renderer is reading. */
export async function installAssetFiles(
  root: string,
  files: Record<string, Uint8Array>,
  digest: string,
): Promise<void> {
  await mkdir(path.dirname(root), { recursive: true });
  const staging = await mkdtemp(`${root}.partial-`);
  try {
    for (const [name, bytes] of Object.entries(files)) {
      if (name.endsWith("/")) continue;
      const target = path.join(staging, name);
      await mkdir(path.dirname(target), { recursive: true });
      await Bun.write(target, bytes);
    }
    await Bun.write(path.join(staging, ".complete"), `${digest}\n`);
    try {
      await rename(staging, root);
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        (error.code === "EEXIST" || error.code === "ENOTEMPTY")
      ))
        throw error;
      const marker = Bun.file(path.join(root, ".complete"));
      if (!(await marker.exists()) || (await marker.text()) !== `${digest}\n`)
        throw error;
      // Another initializer published this same complete pack first.
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
