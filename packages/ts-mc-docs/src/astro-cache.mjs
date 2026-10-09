import { resolve } from "node:path";

/**
 * Give each Astro process its own Vite dependency cache so concurrent checks,
 * builds, and dev servers do not write to the same dependency directory.
 */
function getAstroCacheDir(root = process.cwd(), processId = process.pid) {
  return resolve(root, "node_modules/.vite", `astro-${processId}`);
}

export { getAstroCacheDir };
