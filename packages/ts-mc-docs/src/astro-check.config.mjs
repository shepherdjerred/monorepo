import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const configPath = ["..", "astro.config.ts"].join("/");
const config = require(configPath).default;

/**
 * Give each check process its own Vite dependency cache. Astro's check command
 * can run concurrently with another check (or a dev server), and Vite's shared
 * deps directory is not safe for those concurrent writers.
 */
function getAstroCheckCacheDir(root = process.cwd(), processId = process.pid) {
  return resolve(root, "node_modules/.vite", `astro-check-${processId}`);
}

export { getAstroCheckCacheDir };

export default {
  ...config,
  vite: {
    ...(config.vite ?? {}),
    cacheDir: getAstroCheckCacheDir(),
  },
};
