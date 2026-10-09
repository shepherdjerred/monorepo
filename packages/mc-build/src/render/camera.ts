import type { V3 } from "./mesh.ts";
import type { Projected } from "./raster.ts";

export type ViewName =
  | "iso-front-right"
  | "iso-front-left"
  | "iso-back-left"
  | "iso-back-right"
  | "front"
  | "right"
  | "back"
  | "left"
  | "top";

export const VIEW_LABELS: Record<ViewName, string> = {
  "iso-front-right": "ISO FRONT-RIGHT (SE)",
  "iso-front-left": "ISO FRONT-LEFT (SW)",
  "iso-back-left": "ISO BACK-LEFT (NW)",
  "iso-back-right": "ISO BACK-RIGHT (NE)",
  front: "FRONT (FROM SOUTH)",
  right: "RIGHT (FROM EAST)",
  back: "BACK (FROM NORTH)",
  left: "LEFT (FROM WEST)",
  top: "TOP (NORTH UP)",
};

type Basis = { right: V3; up: V3; back: V3 };

function cross(a: V3, b: V3): V3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(v: V3): V3 {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
}

function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Orthographic camera from yaw (0 = camera south of the build looking north;
 * 90 = east) and pitch (degrees above the horizon).
 */
function basis(yawDegrees: number, pitchDegrees: number): Basis {
  if (pitchDegrees >= 90) {
    return { right: [1, 0, 0], up: [0, 0, -1], back: [0, 1, 0] };
  }
  const yaw = (yawDegrees * Math.PI) / 180;
  const pitch = (pitchDegrees * Math.PI) / 180;
  const back = normalize([
    Math.cos(pitch) * Math.sin(yaw),
    Math.sin(pitch),
    Math.cos(pitch) * Math.cos(yaw),
  ]);
  const right = normalize(cross([0, 1, 0], back));
  const up = cross(back, right);
  return { right, up, back };
}

const VIEWS: Record<ViewName, [yaw: number, pitch: number]> = {
  "iso-front-right": [45, 30],
  "iso-front-left": [-45, 30],
  "iso-back-left": [-135, 30],
  "iso-back-right": [135, 30],
  front: [0, 0],
  right: [90, 0],
  back: [180, 0],
  left: [-90, 0],
  top: [0, 90],
};

/** Unscaled projection: screen x right, screen y down, depth (smaller = nearer). */
export function viewProjector(view: ViewName): (point: V3) => Projected {
  const [yaw, pitch] = VIEWS[view];
  const { right, up, back } = basis(yaw, pitch);
  return (point) => ({
    x: dot(point, right),
    y: -dot(point, up),
    depth: -dot(point, back),
  });
}

/** Scales and centres a projection so a box of `size` fits `width`×`height`. */
/** The frame margin `fitProjector` leaves around a grid, in pixels. */
export const FIT_MARGIN = 24;

/** The box a grid's eight corners project to in a view, at one pixel per block. */
export function projectedExtent(
  view: ViewName,
  size: V3,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const raw = viewProjector(view);
  const corners: V3[] = [];
  for (const x of [0, size[0]]) {
    for (const y of [0, size[1]]) {
      for (const z of [0, size[2]]) {
        corners.push([x, y, z]);
      }
    }
  }
  const points = corners.map((corner) => raw(corner));
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

/**
 * Fits the grid into the frame at a whole-number-friendly scale of at least
 * one pixel per block (faces thinner than a pixel drop out of the raster).
 * A grid too large for that is the caller's to oversample: see `renderView`.
 */
export function fitProjector(
  view: ViewName,
  size: V3,
  frame: { width: number; height: number; margin?: number },
): { project: (point: V3) => Projected; scale: number } {
  const { width, height } = frame;
  const margin = frame.margin ?? FIT_MARGIN;
  const raw = viewProjector(view);
  const { minX, maxX, minY, maxY } = projectedExtent(view, size);
  const scale = Math.max(
    1,
    Math.min(
      48,
      (width - margin * 2) / Math.max(1e-6, maxX - minX),
      (height - margin * 2) / Math.max(1e-6, maxY - minY),
    ),
  );
  const offsetX = (width - (maxX - minX) * scale) / 2 - minX * scale;
  const offsetY = (height - (maxY - minY) * scale) / 2 - minY * scale;
  return {
    scale,
    project: (point) => {
      const p = raw(point);
      return {
        x: p.x * scale + offsetX,
        y: p.y * scale + offsetY,
        depth: p.depth,
      };
    },
  };
}
