import type { BlockGrid } from "#src/core/grid.ts";
import type { ViewName } from "./camera.ts";
import { drawText } from "./font.ts";
import type { Quad, V3 } from "./mesh.ts";
import { Image } from "./raster.ts";
import { renderView, type RenderMode } from "./sheet.ts";

/**
 * The judge sheet is what a vision judge or critic sees: one fixed layout,
 * no build name (only `label`, a letter, so blind comparisons stay blind),
 * and views chosen for judging rather than for authoring: a textured hero,
 * a plan, the same hero in value (tonal massing) and normal (relief) modes,
 * and fixed close-ups at twice the scale.
 */
export type JudgeSheetKind = "micro" | "map";

const PANEL = [36, 40, 48, 255] as const;
const INK = [236, 240, 245, 255] as const;

const HEADER = 44;
const LABEL = 26;
const COLUMNS = 4;
const ROWS = 2;

type Window = { x: number; y: number };

type Panel =
  | { label: string; view: ViewName; mode: RenderMode }
  | { label: string; view: ViewName; mode: RenderMode; crop: Window };

/** Fixed windows, as fractions of a view rendered at twice the tile size. */
const MICRO_PANELS: readonly Panel[] = [
  { label: "HERO", view: "iso-front-right", mode: "textured" },
  { label: "FRONT", view: "front", mode: "textured" },
  { label: "PLAN", view: "top", mode: "textured" },
  { label: "VALUE", view: "iso-front-right", mode: "value" },
  { label: "NORMAL", view: "iso-front-right", mode: "normal" },
  {
    label: "CLOSE 1 FRONT CENTRE",
    view: "front",
    mode: "textured",
    crop: { x: 0.25, y: 0.25 },
  },
  {
    label: "CLOSE 2 ISO LEFT",
    view: "iso-front-left",
    mode: "textured",
    crop: { x: 0, y: 0 },
  },
  {
    label: "CLOSE 3 ISO BACK",
    view: "iso-back-right",
    mode: "textured",
    crop: { x: 0.25, y: 0.25 },
  },
];

const MAP_PANELS: readonly Panel[] = [
  { label: "HERO", view: "iso-front-right", mode: "textured" },
  { label: "PLAN", view: "top", mode: "textured" },
  { label: "VALUE", view: "iso-front-right", mode: "value" },
  { label: "NORMAL", view: "iso-front-right", mode: "normal" },
  {
    label: "CLOSE NW",
    view: "iso-front-right",
    mode: "textured",
    crop: { x: 0, y: 0 },
  },
  {
    label: "CLOSE NE",
    view: "iso-front-right",
    mode: "textured",
    crop: { x: 0.5, y: 0 },
  },
  {
    label: "CLOSE SW",
    view: "iso-front-right",
    mode: "textured",
    crop: { x: 0, y: 0.5 },
  },
  {
    label: "CLOSE SE",
    view: "iso-front-right",
    mode: "textured",
    crop: { x: 0.5, y: 0.5 },
  },
];

export const JUDGE_PANELS: Record<JudgeSheetKind, readonly Panel[]> = {
  micro: MICRO_PANELS,
  map: MAP_PANELS,
};

/** Copies a `size`×`size` window out of `source`. */
function cropImage(source: Image, x0: number, y0: number, size: number): Image {
  const out = new Image(size, size, PANEL);
  for (let y = 0; y < size; y += 1) {
    const sy = y0 + y;
    if (sy < 0 || sy >= source.height) continue;
    const start = (sy * source.width + x0) * 4;
    out.pixels.set(
      source.pixels.subarray(start, start + size * 4),
      y * size * 4,
    );
  }
  return out;
}

function renderPanel(
  quads: readonly Quad[],
  gridSize: V3,
  panel: Panel,
  tile: number,
): Image {
  if (!("crop" in panel)) {
    return renderView(quads, gridSize, panel.view, {
      size: tile,
      mode: panel.mode,
    });
  }
  const zoomed = renderView(quads, gridSize, panel.view, {
    size: tile * 2,
    mode: panel.mode,
  });
  return cropImage(
    zoomed,
    Math.round(panel.crop.x * tile * 2),
    Math.round(panel.crop.y * tile * 2),
    tile,
  );
}

/**
 * Renders the judge sheet. `label` is the only identity on the image; keep
 * it to a letter when the sheet goes to a blind judge. The default tile keeps
 * the sheet under 2000 px wide, which vision models accept without resizing.
 */
export function renderJudgeSheet(
  quads: readonly Quad[],
  grid: BlockGrid,
  options: { kind: JudgeSheetKind; label: string; tile?: number },
): Image {
  const tile = options.tile ?? 480;
  const panels = JUDGE_PANELS[options.kind];
  const sheet = new Image(
    COLUMNS * tile,
    HEADER + ROWS * (tile + LABEL),
    PANEL,
  );
  drawText(sheet, options.label, { x: 14, y: 10, scale: 3, color: INK });
  const gridSize: V3 = [grid.size.x, grid.size.y, grid.size.z];
  panels.forEach((panel, index) => {
    const x = (index % COLUMNS) * tile;
    const y = HEADER + Math.floor(index / COLUMNS) * (tile + LABEL);
    sheet.blit(renderPanel(quads, gridSize, panel, tile), x, y + LABEL);
    drawText(sheet, panel.label, { x: x + 8, y: y + 7, scale: 2, color: INK });
  });
  return sheet;
}
