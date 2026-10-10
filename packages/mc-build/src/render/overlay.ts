/**
 * Block-coordinate grid lines on plan and elevation views, so a critique can
 * say "the gap at x 14–16" instead of "on the left somewhere".
 */
import type { ViewName } from "./camera.ts";
import { drawText } from "./font.ts";
import type { V3 } from "./mesh.ts";
import type { Image, Projected } from "./raster.ts";

type Rgba = readonly [number, number, number, number];
const LINE: Rgba = [20, 24, 32, 110];
const MAJOR: Rgba = [20, 24, 32, 170];
const LABEL: Rgba = [20, 24, 32, 255];

function drawLine(image: Image, a: Projected, b: Projected, rgba: Rgba): void {
  const steps = Math.max(
    1,
    Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))),
  );
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const px = Math.round(a.x + (b.x - a.x) * t);
    const py = Math.round(a.y + (b.y - a.y) * t);
    if (px >= 0 && py >= 0 && px < image.width && py < image.height) {
      image.blend(px, py, [rgba[0], rgba[1], rgba[2], rgba[3]]);
    }
  }
}

type GridLine = { a: V3; b: V3; value: number };

/**
 * The plane each flat view looks at, as two axes: lines of constant `u`
 * run along `v`, and the plane sits at `fixed` on the third axis.
 */
type Plane = {
  u: 0 | 1 | 2;
  v: 0 | 1 | 2;
  fixed: (size: V3) => Partial<Record<0 | 1 | 2, number>>;
};

const PLANES: Partial<Record<ViewName, Plane>> = {
  top: { u: 0, v: 2, fixed: (size) => ({ 1: size[1] }) },
  front: { u: 0, v: 1, fixed: (size) => ({ 2: size[2] }) },
  back: { u: 0, v: 1, fixed: () => ({ 2: 0 }) },
  right: { u: 2, v: 1, fixed: (size) => ({ 0: size[0] }) },
  left: { u: 2, v: 1, fixed: () => ({ 0: 0 }) },
};

function linesFor(plane: Plane, size: V3, every: number): GridLine[] {
  const fixed = plane.fixed(size);
  const point = (
    axis: 0 | 1 | 2,
    value: number,
    other: 0 | 1 | 2,
    otherValue: number,
  ): V3 => {
    const out: V3 = [fixed[0] ?? 0, fixed[1] ?? 0, fixed[2] ?? 0];
    out[axis] = value;
    out[other] = otherValue;
    return out;
  };
  const lines: GridLine[] = [];
  for (const [axis, other] of [
    [plane.u, plane.v],
    [plane.v, plane.u],
  ] as const) {
    for (let value = 0; value <= size[axis]; value += every) {
      lines.push({
        a: point(axis, value, other, 0),
        b: point(axis, value, other, size[other]),
        value,
      });
    }
  }
  return lines;
}

/**
 * Lines every `every` blocks (heavier and labelled every 5×) on the plane the
 * view looks at: the ground for `top`, the wall plane for elevations.
 * Isometric views get no overlay; their axes are not screen-aligned.
 */
export function drawGridOverlay(
  image: Image,
  options: {
    project: (point: V3) => Projected;
    gridSize: V3;
    view: ViewName;
    every: number;
  },
): void {
  const plane = PLANES[options.view];
  if (plane === undefined || options.every <= 0) return;
  for (const line of linesFor(plane, options.gridSize, options.every)) {
    const major = line.value % (options.every * 5) === 0;
    const a = options.project(line.a);
    const b = options.project(line.b);
    drawLine(image, a, b, major ? MAJOR : LINE);
    if (major) {
      drawText(image, line.value.toString(), {
        x: Math.round(Math.min(a.x, b.x)) + 2,
        y: Math.round(Math.min(a.y, b.y)) + 2,
        scale: 1,
        color: LABEL,
      });
    }
  }
}
