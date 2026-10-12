import { blockId, isAir } from "#src/core/block-state.ts";
import type { BlockGrid } from "#src/core/grid.ts";
import {
  FIT_MARGIN,
  fitProjector,
  projectedExtent,
  VIEW_LABELS,
  type ViewName,
} from "./camera.ts";
import { drawText, textWidth } from "./font.ts";
import type { Quad, V3 } from "./mesh.ts";
import { drawGridOverlay } from "./overlay.ts";
import { Image, rasterize, type Projected } from "./raster.ts";

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
      normal: facing === "z" ? [0, 0, 1] : [1, 0, 0],
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

/**
 * How a view is drawn. `textured` is the default; `value` is the same view
 * in grays (tonal massing without texture); `normal` paints every face by
 * its outward normal, so flat walls read as one flat colour and relief shows
 * as colour changes.
 */
export type RenderMode =
  "textured" | "value" | "normal" | "squint" | "relief" | "light";

/** Separable box blur, in place: the "half-closed eyes" test of massing. */
/** Mean of a channel over `radius` pixels either side of `i` along one line. */
function boxMean(
  source: Uint8Array,
  line: { base: number; stride: number; length: number },
  i: number,
  radius: number,
): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let k = -radius; k <= radius; k += 1) {
    const j = i + k;
    if (j < 0 || j >= line.length) continue;
    const at = (line.base + j * line.stride) * 4;
    r += source[at] ?? 0;
    g += source[at + 1] ?? 0;
    b += source[at + 2] ?? 0;
    count += 1;
  }
  return [r / count, g / count, b / count];
}

function blurPass(
  source: Uint8Array,
  target: Uint8Array,
  layout: { lines: number; length: number; stride: number; lineStride: number },
  radius: number,
): void {
  for (let line = 0; line < layout.lines; line += 1) {
    const base = line * layout.lineStride;
    for (let i = 0; i < layout.length; i += 1) {
      const mean = boxMean(
        source,
        { base, stride: layout.stride, length: layout.length },
        i,
        radius,
      );
      const at = (base + i * layout.stride) * 4;
      target[at] = Math.round(mean[0]);
      target[at + 1] = Math.round(mean[1]);
      target[at + 2] = Math.round(mean[2]);
      target[at + 3] = source[at + 3] ?? 255;
    }
  }
}

export function squint(image: Image, radius: number): void {
  if (radius < 1) return;
  const { width, height, pixels } = image;
  const temp = new Uint8Array(pixels.length);
  blurPass(
    pixels,
    temp,
    { lines: height, length: width, stride: 1, lineStride: width },
    radius,
  );
  blurPass(
    temp,
    pixels,
    { lines: width, length: height, stride: width, lineStride: 1 },
    radius,
  );
}

function faceNormal(quad: Quad): V3 {
  if (quad.normal !== null) {
    return quad.normal;
  }
  const [a, b, , d] = quad.corners;
  const u: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v: V3 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  const n: V3 = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const length = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / length, n[1] / length, n[2] / length];
}

/** Every quad drawn flat white, coloured by its normal mapped to 0..1. */
function normalQuads(quads: readonly Quad[]): Quad[] {
  return quads.map((quad) => {
    const n = faceNormal(quad);
    return {
      ...quad,
      texture: WHITE,
      uv: [
        [0, 0],
        [16, 0],
        [16, 16],
        [0, 16],
      ],
      color: [(n[0] + 1) / 2, (n[1] + 1) / 2, (n[2] + 1) / 2],
    };
  });
}

/** Replaces every pixel's colour with its luma, in place. */
function toValue(image: Image): void {
  const { pixels } = image;
  for (let index = 0; index < pixels.length; index += 4) {
    const luma = Math.round(
      0.2126 * (pixels[index] ?? 0) +
        0.7152 * (pixels[index + 1] ?? 0) +
        0.0722 * (pixels[index + 2] ?? 0),
    );
    pixels[index] = luma;
    pixels[index + 1] = luma;
    pixels[index + 2] = luma;
  }
}

/** The grid plus the room the scale figure takes in the elevations. */
function viewBox(view: ViewName, gridSize: V3): V3 {
  if (view === "front") return [gridSize[0] + 2, gridSize[1], gridSize[2]];
  return view === "right"
    ? [gridSize[0], gridSize[1], gridSize[2] + 2]
    : gridSize;
}

/**
 * How many times larger a tile has to be drawn for the whole grid to fit at
 * one pixel per block (the projector's floor), before shrinking it back. A
 * 500-block map in a 480 px tile draws at 960 px and comes back averaged,
 * instead of losing its corners.
 */
function oversample(view: ViewName, box: V3, size: number): number {
  const extent = projectedExtent(view, box);
  const span = Math.max(extent.maxX - extent.minX, extent.maxY - extent.minY);
  // Tiny tiles (tests, thumbnails) give up the margin rather than oversample.
  const room = Math.max(size / 2, size - FIT_MARGIN * 2);
  return Math.max(1, Math.ceil(span / room));
}

/** Renders one orthographic view of the quads into a `size`×`size` tile. */
/** The quads a mode draws: `normal` recolours every face by its facing. */
export function modeQuads(
  quads: readonly Quad[],
  mode: RenderMode,
): readonly Quad[] {
  return mode === "normal" ? normalQuads(quads) : quads;
}

/** The post-pass a mode applies to a rendered image (`value` and `squint`). */
export function finishMode(image: Image, mode: RenderMode): void {
  if (mode === "value") toValue(image);
  if (mode === "squint") {
    squint(
      image,
      Math.max(1, Math.round(Math.max(image.width, image.height) / 60)),
    );
  }
}

/**
 * The projector `renderView` draws a `size`×`size` tile of this grid with,
 * oversampling included, so an overlay (the compare plan's change markers)
 * lands on the same pixels as the blocks.
 */
export function viewProjection(
  view: ViewName,
  gridSize: V3,
  size: number,
): { project: (point: V3) => Projected; scale: number } {
  const box = viewBox(view, gridSize);
  const over = oversample(view, box, size);
  const fitted = fitProjector(view, box, {
    width: size * over,
    height: size * over,
  });
  const shift = view === "front" ? 2 : 0;
  return {
    scale: fitted.scale / over,
    project: (point) => {
      const p = fitted.project([point[0] + shift, point[1], point[2]]);
      return { x: p.x / over, y: p.y / over, depth: p.depth };
    },
  };
}

export function renderView(
  quads: readonly Quad[],
  gridSize: V3,
  view: ViewName,
  options: { size: number; mode?: RenderMode; grid?: number },
): Image {
  const { size } = options;
  const box = viewBox(view, gridSize);
  const over = oversample(view, box, size);
  if (over > 1) {
    return renderView(quads, gridSize, view, {
      ...options,
      size: size * over,
    }).shrink(over);
  }
  const mode = options.mode ?? "textured";
  quads = modeQuads(quads, mode);
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
  const { project } = fitProjector(view, box, { width: size, height: size });
  const shifted =
    view === "front"
      ? (point: V3) => project([point[0] + 2, point[1], point[2]])
      : project;
  rasterize(tile, withPlayer, shifted);
  finishMode(tile, mode);
  if (options.grid !== undefined) {
    drawGridOverlay(tile, {
      project: shifted,
      gridSize,
      view,
      every: options.grid,
    });
  }
  return tile;
}

/**
 * Contact sheet: four isometric corners, front and right elevations (with a
 * player for scale), a top plan, and a stats panel.
 */
export function renderSheet(
  quads: readonly Quad[],
  grid: BlockGrid,
  options: {
    title: string;
    subtitle?: string;
    tile?: number;
    mode?: RenderMode;
    grid?: number;
  },
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
    sheet.blit(
      renderView(quads, gridSize, view, {
        size: tile,
        ...(options.mode === undefined ? {} : { mode: options.mode }),
        ...(options.grid === undefined ? {} : { grid: options.grid }),
      }),
      x,
      y + label,
    );
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
