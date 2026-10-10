import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const ownedCaches = new Set();
process.once("exit", () => {
  for (const cache of ownedCaches) {
    rmSync(cache, { recursive: true, force: true });
  }
});

/**
 * Give each Astro process its own Vite dependency cache so concurrent checks,
 * builds, and dev servers do not write to the same dependency directory.
 */
function getAstroCacheDir(root = process.cwd(), processId = process.pid) {
  return resolve(root, "node_modules/.vite", `astro-${processId}`);
}

/** Remove abandoned caches without disturbing another running Astro process. */
function createAstroCacheDir(root = process.cwd()) {
  const cacheDir = getAstroCacheDir(root);
  const cacheRoot = resolve(cacheDir, "..");
  mkdirSync(cacheRoot, { recursive: true });
  for (const entry of readdirSync(cacheRoot, { withFileTypes: true })) {
    const match = /^astro-([1-9]\d*)$/.exec(entry.name);
    if (!entry.isDirectory() || match === null) continue;
    const pid = Number(match[1]);
    if (!Number.isSafeInteger(pid) || pid > 2_147_483_647) continue;
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "EPERM") continue;
      if (error.code !== "ESRCH") throw error;
      rmSync(resolve(cacheRoot, entry.name), { recursive: true, force: true });
    }
  }
  ownedCaches.add(cacheDir);
  return cacheDir;
}

export { createAstroCacheDir, getAstroCacheDir };
