import { blockId, isAir } from "#src/core/block-state.ts";
import type { BlockGrid } from "#src/core/grid.ts";
import { fitProjector, VIEW_LABELS, type ViewName } from "./camera.ts";
import { drawText, textWidth } from "./font.ts";
import type { Quad, V3 } from "./mesh.ts";
import { Image, rasterize } from "./raster.ts";

const BACKGROUND = [222, 228, 236, 255] as const;
const PANEL = [36, 40, 48, 255] as const;
const INK = [236, 240, 245, 255] as const;
const DIM = [150, 160, 175, 255] as const;

export const SHEET_VIEWS: readonly ViewName[] = [
  "iso-front-right",
  "iso-front-left",
  "iso-back-left",
  "iso-back-right",
  "front",
  "right",
  "top",
];

/** A 2-block-tall player silhouette (legs, body, head) in world units. */
function playerQuads(
  at: V3,
  facing: "z" | "x",
  texture: Quad["texture"],
): Quad[] {
  const parts: [number, number, [number, number, number]][] = [
    [0, 0.75, [0.2, 0.25, 0.55]],
    [0.75, 1.5, [0, 0.62, 0.66]],
    [1.5, 2, [0.78, 0.6, 0.43]],
  ];
  const half = 0.3;
  return parts.map(([y0, y1, color]) => {
    const [x, , z] = at;
    const corners: Quad["corners"] =
      facing === "z"
        ? [
            [x - half, y1, z],
            [x + half, y1, z],
            [x + half, y0, z],
            [x - half, y0, z],
          ]
        : [
            [x, y1, z + half],
            [x, y1, z - half],
            [x, y0, z - half],
            [x, y0, z + half],
          ];
    return {
      corners,
      uv: [
        [0, 0],
        [16, 0],
        [16, 16],
        [0, 16],
      ],
      texture,
      color,
      layer: "solid",
      alpha: 1,
    };
  });
}

const WHITE: Quad["texture"] = {
  width: 1,
  height: 1,
  pixels: new Uint8Array([255, 255, 255, 255]),
  cutout: false,
  translucent: false,
};

/** Renders one orthographic view of the quads into a `size`×`size` tile. */
export function renderView(
  quads: readonly Quad[],
  gridSize: V3,
  view: ViewName,
  size: number,
): Image {
  const tile = new Image(size, size, BACKGROUND);
  const withPlayer =
    view === "front"
      ? [...quads, ...playerQuads([-1.5, 0, gridSize[2] + 0.01], "z", WHITE)]
      : view === "right"
        ? [
            ...quads,
            ...playerQuads(
              [gridSize[0] + 0.01, 0, gridSize[2] + 1.5],
              "x",
              WHITE,
            ),
          ]
        : quads;
  const box: V3 =
    view === "front"
      ? [gridSize[0] + 2, gridSize[1], gridSize[2]]
      : view === "right"
        ? [gridSize[0], gridSize[1], gridSize[2] + 2]
        : gridSize;
  const { project } = fitProjector(view, box, { width: size, height: size });
  const shifted =
    view === "front"
      ? (point: V3) => project([point[0] + 2, point[1], point[2]])
      : project;
  rasterize(tile, withPlayer, shifted);
  return tile;
}

/**
 * Contact sheet: four isometric corners, front and right elevations (with a
 * player for scale), a top plan, and a stats panel.
 */
export function renderSheet(
  quads: readonly Quad[],
  grid: BlockGrid,
  options: { title: string; subtitle?: string; tile?: number },
): Image {
  const tile = options.tile ?? 440;
  const label = 26;
  const columns = 4;
  const rows = 2;
  const header = 44;
  const sheet = new Image(
    columns * tile,
    header + rows * (tile + label),
    PANEL,
  );
  drawText(sheet, options.title, { x: 14, y: 10, scale: 3, color: INK });
  if (options.subtitle !== undefined) {
    drawText(sheet, options.subtitle, {
      x: 14 + textWidth(options.title, 3) + 18,
      y: 17,
      scale: 2,
      color: DIM,
    });
  }
  const gridSize: V3 = [grid.size.x, grid.size.y, grid.size.z];
  SHEET_VIEWS.forEach((view, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = column * tile;
    const y = header + row * (tile + label);
    sheet.blit(renderView(quads, gridSize, view, tile), x, y + label);
    drawText(sheet, VIEW_LABELS[view], {
      x: x + 8,
      y: y + 7,
      scale: 2,
      color: INK,
    });
  });
  // Stats panel in the last slot.
  const px = 3 * tile + 12;
  const py = header + tile + label + label + 6;
  const counts = new Map<string, number>();
  let blocks = 0;
  for (const value of grid.data) {
    const state = grid.palette[value] ?? "minecraft:air";
    if (!isAir(state)) {
      blocks += 1;
      const id = blockId(state).replace(/^minecraft:/u, "");
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  drawText(sheet, "STATS", {
    x: 3 * tile + 8,
    y: header + tile + label + 7,
    scale: 2,
    color: INK,
  });
  const lines = [
    `SIZE ${grid.size.x.toString()}×${grid.size.y.toString()}×${grid.size.z.toString()}`,
    `BLOCKS ${blocks.toString()}`,
    "",
    ...[...counts]
      .toSorted((a, b) => b[1] - a[1])
      .slice(0, 16)
      .map(
        ([id, count]) =>
          `${count.toString().padStart(5, " ")} ${id.slice(0, 26)}`,
      ),
  ];
  lines.forEach((line, index) => {
    drawText(sheet, line, {
      x: px,
      y: py + index * 22,
      scale: 2,
      color: index < 2 ? INK : DIM,
    });
  });
  return sheet;
}
