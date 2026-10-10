/**
 * A survey is the whole site at full detail in tiles small enough to read,
 * plus an index image that says which tile covers which blocks. Map-scale
 * builds are reviewed one tile at a time this way. The quads come from the
 * whole grid and are cropped per tile, so a tile is shaded by its
 * neighbours (a tower's shadow crosses into the next tile) exactly as the
 * full view would be.
 */
import type { BlockGrid } from "#src/core/grid.ts";
import type { ViewName } from "./camera.ts";
import { cropQuads } from "./cut.ts";
import { drawText } from "./font.ts";
import type { Quad } from "./mesh.ts";
import { Image } from "./raster.ts";
import { renderView, type RenderMode } from "./sheet.ts";

const PANEL = [36, 40, 48, 255] as const;
const INK = [236, 240, 245, 255] as const;
const DIM = [150, 160, 175, 255] as const;

export type SurveyTile = {
  name: string;
  /** Local block range the tile covers, inclusive. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  image: Image;
};

/** `quads` are the whole grid's, already shaded for relief or light by the caller. */
export function renderSurvey(
  grid: BlockGrid,
  quads: readonly Quad[],
  options: {
    view?: ViewName;
    blocksPerTile?: number;
    tile?: number;
    /** The raster pass for each tile; the caller shades the quads for relief and light. */
    mode?: RenderMode;
  } = {},
): { tiles: SurveyTile[]; index: Image } {
  const view = options.view ?? "top";
  const blocks = options.blocksPerTile ?? 64;
  const tile = options.tile ?? 1024;
  const tileOptions = {
    size: tile,
    ...(options.mode === undefined ? {} : { mode: options.mode }),
  };
  const tiles: SurveyTile[] = [];
  const columns = Math.ceil(grid.size.x / blocks);
  const rows = Math.ceil(grid.size.z / blocks);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x0 = column * blocks;
      const z0 = row * blocks;
      const x1 = Math.min(grid.size.x - 1, x0 + blocks - 1);
      const z1 = Math.min(grid.size.z - 1, z0 + blocks - 1);
      const part = cropQuads(quads, {
        min: { x: x0, y: 0, z: z0 },
        max: { x: x1, y: grid.size.y - 1, z: z1 },
      });
      const name = `${String.fromCodePoint(65 + row)}${(column + 1).toString()}`;
      const image = renderView(
        part,
        [x1 - x0 + 1, grid.size.y, z1 - z0 + 1],
        view,
        tileOptions,
      );
      drawText(
        image,
        `${name}  x ${x0.toString()}-${x1.toString()}  z ${z0.toString()}-${z1.toString()}`,
        {
          x: 8,
          y: 8,
          scale: 2,
          color: [20, 24, 32, 255],
        },
      );
      tiles.push({ name, x0, z0, x1, z1, image });
    }
  }
  const cell = 120;
  const index = new Image(
    Math.max(1, columns) * cell,
    Math.max(1, rows) * cell + 30,
    PANEL,
  );
  drawText(
    index,
    `SURVEY ${grid.size.x.toString()}×${grid.size.z.toString()}, ${blocks.toString()}-block tiles`,
    { x: 8, y: 8, scale: 2, color: INK },
  );
  for (const entry of tiles) {
    const column = Math.floor(entry.x0 / blocks);
    const row = Math.floor(entry.z0 / blocks);
    const x = column * cell;
    const y = 30 + row * cell;
    for (let py = y; py < y + cell; py += 1) {
      for (let px = x; px < x + cell; px += 1) {
        if (px === x || py === y) index.blend(px, py, [120, 130, 150, 255]);
      }
    }
    drawText(index, entry.name, { x: x + 8, y: y + 8, scale: 3, color: INK });
    drawText(index, `x${entry.x0.toString()} z${entry.z0.toString()}`, {
      x: x + 8,
      y: y + 40,
      scale: 1,
      color: DIM,
    });
  }
  return { tiles, index };
}
