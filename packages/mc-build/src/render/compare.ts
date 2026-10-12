/**
 * Before/after: the same view of two grids side by side, with a plan of what
 * changed. The critique loop uses it to see whether one change did anything.
 */
import type { BlockGrid } from "#src/core/grid.ts";
import type { ViewName } from "./camera.ts";
import { occupiedHeight } from "./cut.ts";
import { drawText } from "./font.ts";
import type { Quad, V3 } from "./mesh.ts";
import { Image } from "./raster.ts";
import { renderView, viewProjection, type RenderMode } from "./sheet.ts";

const PANEL = [36, 40, 48, 255] as const;
const INK = [236, 240, 245, 255] as const;
const CHANGED = [230, 60, 50, 150] as const;
const LABEL = 26;

/**
 * Columns (x, z) where any cell differs between the two grids. The grids
 * must be the same size: cells are compared by local coordinates, so a
 * different box would mark its own edge as a change.
 */
export function changedColumns(
  before: BlockGrid,
  after: BlockGrid,
): Set<string> {
  if (
    before.size.x !== after.size.x ||
    before.size.y !== after.size.y ||
    before.size.z !== after.size.z
  ) {
    throw new Error(
      `cannot compare a ${before.describeSize()} grid with a ${after.describeSize()} grid; align them to one box first`,
    );
  }
  const columns = new Set<string>();
  after.forEach((x, y, z, state) => {
    if (before.get(x, y, z) !== state)
      columns.add(`${x.toString()},${z.toString()}`);
  });
  before.forEach((x, y, z, state) => {
    if (after.get(x, y, z) !== state)
      columns.add(`${x.toString()},${z.toString()}`);
  });
  return columns;
}

export function renderCompare(
  input: {
    before: { quads: readonly Quad[]; grid: BlockGrid };
    after: { quads: readonly Quad[]; grid: BlockGrid };
  },
  options: { view?: ViewName; tile?: number; mode?: RenderMode },
): Image {
  const view = options.view ?? "iso-front-right";
  const tile = options.tile ?? 480;
  const mode = options.mode ?? "textured";
  const sheet = new Image(3 * tile, tile + LABEL, PANEL);
  const height = Math.max(
    occupiedHeight(input.before.grid),
    occupiedHeight(input.after.grid),
  );
  const size = (grid: BlockGrid): V3 => [grid.size.x, height, grid.size.z];
  sheet.blit(
    renderView(input.before.quads, size(input.before.grid), view, {
      size: tile,
      mode,
    }),
    0,
    LABEL,
  );
  sheet.blit(
    renderView(input.after.quads, size(input.after.grid), view, {
      size: tile,
      mode,
    }),
    tile,
    LABEL,
  );
  const plan = renderView(input.after.quads, size(input.after.grid), "top", {
    size: tile,
    mode,
  });
  // The same projection the plan was drawn with, oversampling included, so
  // markers on a map larger than the tile land on the blocks they mark.
  const { project, scale } = viewProjection(
    "top",
    size(input.after.grid),
    tile,
  );
  const radius = Math.max(1, Math.round(scale / 2));
  for (const column of changedColumns(input.before.grid, input.after.grid)) {
    const [x = 0, z = 0] = column.split(",").map(Number);
    const centre = project([x + 0.5, height, z + 0.5]);
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const px = Math.round(centre.x + dx);
        const py = Math.round(centre.y + dy);
        if (px >= 0 && py >= 0 && px < plan.width && py < plan.height) {
          plan.blend(px, py, [CHANGED[0], CHANGED[1], CHANGED[2], CHANGED[3]]);
        }
      }
    }
  }
  sheet.blit(plan, 2 * tile, LABEL);
  for (const [index, label] of [
    "BEFORE",
    "AFTER",
    "CHANGED (PLAN)",
  ].entries()) {
    drawText(sheet, label, { x: index * tile + 8, y: 7, scale: 2, color: INK });
  }
  return sheet;
}
