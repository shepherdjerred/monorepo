/**
 * Renders one build in every look the critique loop can ask for, as a single
 * contact sheet: bun run scripts/render-modes.ts <build.ts|file.schem> <out.png>
 * Useful for eyeballing the modes and for the skill's looking.md examples.
 */
import path from "node:path";
import { ensureAssets } from "#src/render/assets.ts";
import { loadGrid } from "./load-grid.ts";
import { cutGrid } from "#src/render/cut.ts";
import { drawText } from "#src/render/font.ts";
import { encodePng, Renderer } from "#src/render/index.ts";
import { Image } from "#src/render/raster.ts";
import type { RenderMode } from "#src/render/sheet.ts";

const [input, out] = Bun.argv.slice(2);
if (input === undefined || out === undefined) {
  console.error(
    "usage: bun run scripts/render-modes.ts <build.ts|file.schem> <out.png>",
  );
  process.exit(1);
}

const grid = await loadGrid(input, 1);
const renderer = new Renderer(await ensureAssets());
const tile = 420;
const label = 26;
const panels: { name: string; image: Image }[] = [];
const modes: RenderMode[] = [
  "textured",
  "value",
  "normal",
  "squint",
  "relief",
  "light",
];
for (const mode of modes) {
  panels.push({
    name: mode.toUpperCase(),
    image: await renderer.view(grid, "iso-front-right", tile, { mode }),
  });
}
panels.push({
  name: "FRONT, GRID 4",
  image: await renderer.view(grid, "front", tile, { grid: 4 }),
});
panels.push({
  name: "PLAN, GRID 4",
  image: await renderer.view(grid, "top", tile, { grid: 4 }),
});
const floorY = Math.min(grid.size.y - 1, 3);
panels.push({
  name: `FLOOR Y ${floorY.toString()}, LIGHT`,
  image: await renderer.view(cutGrid(grid, { belowY: floorY }), "top", tile, {
    mode: "light",
    lightFrom: grid,
  }),
});
panels.push({
  name: "SECTION, BACK HALF",
  image: await renderer.view(
    cutGrid(grid, { behindZ: Math.floor(grid.size.z / 2) }),
    "iso-front-right",
    tile,
  ),
});
const pov = await renderer.pov(grid, { size: tile * 2 });
const columns = 5;
const rows = Math.ceil(panels.length / columns);
const sheet = new Image(
  columns * tile,
  rows * (tile + label) + pov.height + label,
  [36, 40, 48, 255],
);
panels.forEach((panel, index) => {
  const x = (index % columns) * tile;
  const y = Math.floor(index / columns) * (tile + label);
  sheet.blit(panel.image, x, y + label);
  drawText(sheet, panel.name, {
    x: x + 8,
    y: y + 7,
    scale: 2,
    color: [236, 240, 245, 255],
  });
});
const povY = rows * (tile + label);
sheet.blit(pov, 0, povY + label);
drawText(sheet, "POV (player eye, perspective)", {
  x: 8,
  y: povY + 7,
  scale: 2,
  color: [236, 240, 245, 255],
});
await Bun.write(out, await encodePng(sheet));
process.stdout.write(
  `wrote ${out} (${sheet.width.toString()}×${sheet.height.toString()}) for ${path.basename(input)}\n`,
);
