import { createHash } from "node:crypto";
import type { BlockGrid } from "#src/core/grid.ts";

export type RepetitionReport = {
  /** Cells (cubes of `cell` blocks) with enough blocks or baseline edits to hash. */
  hashed: number;
  /** Hashed cells whose contents duplicate another hashed cell. */
  repeated: number;
  /** `repeated / hashed`, or 0 when nothing was hashed. */
  ratio: number;
  /** Distinct contents that occur more than once. */
  groups: number;
};

/**
 * How much of a build is copy-pasted. The grid is cut into non-overlapping
 * cubes of `cell` blocks; a cube with at least `minFilled` non-air blocks and
 * at least two distinct states is hashed by its contents, shifted to its
 * own non-air min corner so the same house hashes the same wherever it sits
 * inside its cube. Uniform cubes (one state: solid stone, grass) are skipped,
 * because a mass of one block is bulk, not repetition.
 * With `baseline`, hash only changed cells as before/after pairs, including
 * excavations. `minFilled` then counts edits; uniform excavations are hashed.
 */
export function repetitionRatio(
  grid: BlockGrid,
  options: { cell?: number; minFilled?: number; baseline?: BlockGrid } = {},
): RepetitionReport {
  const cell = options.cell ?? 8;
  const minFilled = options.minFilled ?? 48;
  const baseline = options.baseline;
  assertBaselineSize(grid, baseline);
  const counts = new Map<string, number>();
  let hashed = 0;
  for (let bx = 0; bx < grid.size.x; bx += cell) {
    for (let by = 0; by < grid.size.y; by += cell) {
      for (let bz = 0; bz < grid.size.z; bz += cell) {
        const digest = hashCube(grid, [bx, by, bz], {
          cell,
          minFilled,
          baseline,
        });
        if (digest === null) continue;
        hashed += 1;
        counts.set(digest, (counts.get(digest) ?? 0) + 1);
      }
    }
  }
  let repeated = 0;
  let groups = 0;
  for (const count of counts.values()) {
    if (count > 1) {
      groups += 1;
      repeated += count;
    }
  }
  return {
    hashed,
    repeated,
    ratio: hashed === 0 ? 0 : repeated / hashed,
    groups,
  };
}

function assertBaselineSize(grid: BlockGrid, baseline?: BlockGrid): void {
  if (
    baseline !== undefined &&
    (grid.size.x !== baseline.size.x ||
      grid.size.y !== baseline.size.y ||
      grid.size.z !== baseline.size.z)
  ) {
    throw new Error("repetition grid and baseline differ in size");
  }
}

function cellEdit(
  grid: BlockGrid,
  at: [number, number, number],
  baseline?: BlockGrid,
): { state: string; value: string; removal: boolean } | null {
  const air = grid.isAirAt(...at);
  const state = grid.get(...at);
  const before = baseline?.get(...at);
  if (baseline === undefined ? air : state === before) return null;
  return {
    state,
    value: baseline === undefined ? state : JSON.stringify([before, state]),
    removal: air,
  };
}

function hashCube(
  grid: BlockGrid,
  origin: [number, number, number],
  options: { cell: number; minFilled: number; baseline: BlockGrid | undefined },
): string | null {
  const { cell, minFilled, baseline } = options;
  const entries: { x: number; y: number; z: number; state: string }[] = [];
  const states = new Set<string>();
  let removals = 0;
  let min: [number, number, number] = [cell, cell, cell];
  const width = Math.min(cell, grid.size.x - origin[0]);
  const height = Math.min(cell, grid.size.y - origin[1]);
  const depth = Math.min(cell, grid.size.z - origin[2]);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let z = 0; z < depth; z += 1) {
        const gx = origin[0] + x;
        const gy = origin[1] + y;
        const gz = origin[2] + z;
        const edit = cellEdit(grid, [gx, gy, gz], baseline);
        if (edit === null) continue;
        removals += Number(edit.removal);
        entries.push({ x, y, z, state: edit.value });
        states.add(edit.state);
        min = [Math.min(min[0], x), Math.min(min[1], y), Math.min(min[2], z)];
      }
    }
  }
  if (entries.length < minFilled || (removals === 0 && states.size < 2)) {
    return null;
  }
  const hash = createHash("sha1");
  for (const entry of entries) {
    hash.update(
      `${(entry.x - min[0]).toString()},${(entry.y - min[1]).toString()},${(entry.z - min[2]).toString()}:${entry.state}\n`,
    );
  }
  return hash.digest("hex");
}
