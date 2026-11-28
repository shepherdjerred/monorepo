/**
 * Freehand strokes are simplified before they are stored: Ramer-Douglas-Peucker
 * keeps the points that matter, and the tolerance grows until the stroke fits
 * the contract's point cap.
 */
import type { Point } from "#client/lib/geometry.ts";
import { distanceToSegment } from "./shapes.ts";

/** The most points a stored stroke has (`MAX_PEN_POINTS` in the contract). */
export const MAX_STROKE_POINTS = 500;
/** The first tolerance tried, in world pixels. */
export const BASE_TOLERANCE = 0.75;

/** Ramer-Douglas-Peucker: the points of `points` that keep it within `tolerance` of the original line. */
export function simplify(points: readonly Point[], tolerance: number): Point[] {
  const [first] = points;
  const last = points.at(-1);
  if (first === undefined || last === undefined || points.length < 3)
    return [...points];
  // Iterative, so a long stroke cannot overflow the stack.
  const keep = new Set<number>([0, points.length - 1]);
  const stack: [number, number][] = [[0, points.length - 1]];
  for (let range = stack.pop(); range !== undefined; range = stack.pop()) {
    const [from, to] = range;
    const a = points[from];
    const b = points[to];
    if (a === undefined || b === undefined) continue;
    let worst = -1;
    let worstAt = from;
    for (let at = from + 1; at < to; at += 1) {
      const point = points[at];
      if (point === undefined) continue;
      const distance = distanceToSegment(point, a, b);
      if (distance > worst) {
        worst = distance;
        worstAt = at;
      }
    }
    if (worst > tolerance) {
      keep.add(worstAt);
      stack.push([from, worstAt], [worstAt, to]);
    }
  }
  return points.filter((_, at) => keep.has(at));
}

function tenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * A raw stroke as it is stored: simplified (loosening the tolerance until it
 * fits `max`), rounded to a tenth of a pixel, with duplicate neighbours
 * dropped. Null when it is too short to be a stroke.
 */
export function fitStroke(
  raw: readonly Point[],
  max = MAX_STROKE_POINTS,
): Point[] | null {
  const rounded = raw
    .map((point) => ({ x: tenth(point.x), y: tenth(point.y) }))
    .filter(
      (point, at, all) =>
        at === 0 || point.x !== all[at - 1]?.x || point.y !== all[at - 1]?.y,
    );
  if (rounded.length < 2) return null;
  let tolerance = BASE_TOLERANCE;
  let fitted = simplify(rounded, tolerance);
  while (fitted.length > max) {
    tolerance *= 1.5;
    fitted = simplify(rounded, tolerance);
  }
  return fitted;
}
