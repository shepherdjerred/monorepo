import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { overlayRwf, type RwfOverlay } from "./config-overlays.ts";

/**
 * Stages a suite's Search and Destroy settings into a disposable server's
 * `plugins/TheStorm`: overlays `rwf.yml`, and when `rwf.maps` names maps,
 * keeps only those map folders.
 */
export async function stageRwf(
  stormDir: string,
  rwf: RwfOverlay,
): Promise<void> {
  await overlayRwf(path.join(stormDir, "rwf.yml"), rwf);
  if (rwf.maps !== undefined) {
    await keepRwfMaps(path.join(stormDir, "rwf", "maps"), rwf.maps);
  }
}

/** Removes every staged rwf map folder not in `keep`; each kept map must exist. */
async function keepRwfMaps(mapsDir: string, keep: string[]): Promise<void> {
  const staged = await readdir(mapsDir);
  const missing = keep.filter((id) => !staged.includes(id));
  if (missing.length > 0) {
    throw new Error(`rwf maps not shipped: ${missing.join(", ")}`);
  }
  for (const id of staged.filter((entry) => !keep.includes(entry))) {
    await rm(path.join(mapsDir, id), { recursive: true });
  }
}
