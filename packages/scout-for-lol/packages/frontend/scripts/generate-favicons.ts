// Regenerates the raster favicon assets from public/favicon.svg.
// Run with: bun run scripts/generate-favicons.ts
// Requires `rsvg-convert` (librsvg) and `magick` (ImageMagick) on PATH.
// Produces favicon-48x48.png, apple-touch-icon.png (180x180), and a
// multi-size favicon.ico.
import { $ } from "bun";

const publicDir = new URL("../public/", import.meta.url).pathname;
const svg = `${publicDir}favicon.svg`;
const tmp = `${publicDir}.favicon-tmp`;

await $`rsvg-convert -w 48 -h 48 ${svg} -o ${publicDir}favicon-48x48.png`;
await $`rsvg-convert -w 180 -h 180 ${svg} -o ${publicDir}apple-touch-icon.png`;

// Multi-resolution .ico packed from crisp per-size PNG renders.
await $`rsvg-convert -w 16 -h 16 ${svg} -o ${tmp}-16.png`;
await $`rsvg-convert -w 32 -h 32 ${svg} -o ${tmp}-32.png`;
await $`magick ${tmp}-16.png ${tmp}-32.png ${publicDir}favicon-48x48.png ${publicDir}favicon.ico`;
await $`rm -f ${tmp}-16.png ${tmp}-32.png`;

console.log("Wrote favicon-48x48.png, apple-touch-icon.png, favicon.ico");
