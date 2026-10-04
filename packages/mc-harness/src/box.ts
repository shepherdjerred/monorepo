// Block-box geometry shared by build journals and the live guard.
import type { BlockPos, Box } from "#protocol/bridge.ts";

export function boxVolume(box: Box): number {
  return (
    (box.max.x - box.min.x + 1) *
    (box.max.y - box.min.y + 1) *
    (box.max.z - box.min.z + 1)
  );
}

export function boxOf(world: string, a: BlockPos, b: BlockPos): Box {
  return {
    world,
    min: {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      z: Math.min(a.z, b.z),
    },
    max: {
      x: Math.max(a.x, b.x),
      y: Math.max(a.y, b.y),
      z: Math.max(a.z, b.z),
    },
  };
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return (
    a.world === b.world &&
    a.min.x <= b.max.x &&
    b.min.x <= a.max.x &&
    a.min.y <= b.max.y &&
    b.min.y <= a.max.y &&
    a.min.z <= b.max.z &&
    b.min.z <= a.max.z
  );
}

function formatPos(p: BlockPos): string {
  return `${p.x.toString()},${p.y.toString()},${p.z.toString()}`;
}

export function describeBox(box: Box): string {
  return `${box.world} ${formatPos(box.min)} → ${formatPos(box.max)}`;
}

/** Distance along one axis from a coordinate to the block span [min, max + 1]. */
function axis(value: number, min: number, max: number): number {
  if (value < min) {
    return min - value;
  }
  return value > max + 1 ? value - (max + 1) : 0;
}

/** Distance from a player position to the box (0 when inside). */
export function distanceToBox(
  box: Box,
  pos: { x: number; y: number; z: number },
): number {
  const dx = axis(pos.x, box.min.x, box.max.x);
  const dy = axis(pos.y, box.min.y, box.max.y);
  const dz = axis(pos.z, box.min.z, box.max.z);
  return Math.hypot(dx, dy, dz);
}
