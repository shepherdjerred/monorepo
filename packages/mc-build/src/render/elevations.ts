/**
 * The four elevations and the plan in one strip, each with a coordinate grid,
 * for proportion and rhythm checks the isometric sheet cannot support.
 */
import type { BlockGrid } from "#src/core/grid.ts";
import { VIEW_LABELS, type ViewName } from "./camera.ts";
import { drawText } from "./font.ts";
import type { Quad, V3 } from "./mesh.ts";
import { Image } from "./raster.ts";
import { renderView, type RenderMode } from "./sheet.ts";

const PANEL = [36, 40, 48, 255] as const;
const INK = [236, 240, 245, 255] as const;
const LABEL = 26;

export const ELEVATION_VIEWS: readonly ViewName[] = [
  "front",
  "right",
  "back",
  "left",
  "top",
];

export function renderElevationSheet(
  quads: readonly Quad[],
  grid: BlockGrid,
  options: { tile?: number; grid?: number; mode?: RenderMode } = {},
): Image {
  const tile = options.tile ?? 400;
  const every = options.grid ?? 8;
  const sheet = new Image(ELEVATION_VIEWS.length * tile, tile + LABEL, PANEL);
  const gridSize: V3 = [grid.size.x, grid.size.y, grid.size.z];
  ELEVATION_VIEWS.forEach((view, index) => {
    sheet.blit(
      renderView(quads, gridSize, view, {
        size: tile,
        grid: every,
        ...(options.mode === undefined ? {} : { mode: options.mode }),
      }),
      index * tile,
      LABEL,
    );
    drawText(sheet, VIEW_LABELS[view], {
      x: index * tile + 8,
      y: 7,
      scale: 2,
      color: INK,
    });
  });
  return sheet;
}
