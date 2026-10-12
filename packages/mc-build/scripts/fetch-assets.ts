/** Downloads and caches the renderer's Minecraft client assets (sha1-verified). */
import { ASSETS_VERSION, ensureAssets } from "#src/render/assets.ts";

const root = await ensureAssets(Bun.argv[2] ?? ASSETS_VERSION, (message) => {
  console.error(message);
});
process.stdout.write(`${root}\n`);
