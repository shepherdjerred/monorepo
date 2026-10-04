import { parseBlockState, withProperties } from "#src/core/block-state.ts";
import { BlockGrid } from "#src/core/grid.ts";
import type { BlockRegistry } from "#src/registry/registry.ts";
import { cells } from "./geo.ts";
import {
  AIR,
  KEEP,
  type Box,
  type Material,
  type Region,
  type Vec3,
} from "./types.ts";

/** Blocks panes, fences and walls do not attach to (no sturdy side face). */
const NON_SOLID =
  /(?:_stairs|_slab|_door|_trapdoor|_fence_gate|_sign|_banner|_carpet|_button|_pressure_plate|torch|lantern|_leaves|chest|_bed|ladder|_rail|^minecraft:rail|flower|_sapling|grass|fern|vine|water|lava|^minecraft:snow)$/u;

const SIDES = [
  ["north", 0, -1],
  ["south", 0, 1],
  ["east", 1, 0],
  ["west", -1, 0],
] as const;

type Connects = "pane" | "fence" | "wall" | "solid";

function key(x: number, y: number, z: number): string {
  return `${x.toString()},${y.toString()},${z.toString()}`;
}

function parseKey(position: string): [number, number, number] {
  const [x = 0, y = 0, z = 0] = position.split(",").map(Number);
  return [x, y, z];
}

function connectKind(state: string | undefined): Connects | null {
  if (state === undefined) {
    return null;
  }
  if (state === AIR) {
    return null;
  }
  const { id } = parseBlockState(state);
  if (id === "minecraft:iron_bars" || id.endsWith("_pane")) {
    return "pane";
  }
  if (id.endsWith("_fence")) {
    return "fence";
  }
  if (id.endsWith("_wall")) {
    return "wall";
  }
  return NON_SOLID.test(id) ? null : "solid";
}

function joins(self: Connects, other: Connects | null): boolean {
  if (other === null) {
    return false;
  }
  if (other === "solid" || other === self) {
    return true;
  }
  // Panes and walls join each other; fences only join fences and solids.
  return self !== "fence" && other !== "fence";
}

/** Compiled output of a build program, in local coordinates. */
export type CompiledBuild = {
  /** Local position of grid cell (0,0,0); paste at anchor + min. */
  min: Vec3;
  /** KEEP and AIR cells are air here; paste with ignoreAir. */
  grid: BlockGrid;
  /** Explicit AIR cells merged into boxes (local), cleared before the paste. */
  clears: Box[];
};

/**
 * Sparse block canvas the DSL writes into. Cells start as KEEP; any local
 * coordinate (including negatives for overhangs) is allowed. Every state is
 * validated against the registry as it is written.
 */
export class BuildCanvas {
  private readonly blocks = new Map<string, string>();
  private readonly resolved = new Map<string, string>();

  constructor(private readonly registry: BlockRegistry) {}

  private resolve(state: string): string {
    if (state === KEEP) {
      return KEEP;
    }
    let canonical = this.resolved.get(state);
    if (canonical === undefined) {
      canonical = this.registry.resolve(state);
      this.resolved.set(state, canonical);
    }
    return canonical;
  }

  set(x: number, y: number, z: number, material: Material): void {
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) {
      throw new TypeError(
        `Block positions must be integers, got (${String(x)}, ${String(y)}, ${String(z)})`,
      );
    }
    const state = this.resolve(
      typeof material === "string" ? material : material(x, y, z),
    );
    if (state === KEEP) {
      this.blocks.delete(key(x, y, z));
    } else {
      this.blocks.set(key(x, y, z), state);
    }
  }

  /** The state written at a cell, or KEEP. */
  get(x: number, y: number, z: number): string {
    return this.blocks.get(key(x, y, z)) ?? KEEP;
  }

  fill(region: Region | Box, material: Material): void {
    const target: Region =
      "bounds" in region ? region : { bounds: region, has: () => true };
    for (const [x, y, z] of cells(target)) {
      this.set(x, y, z, material);
    }
  }

  /** Explicitly clears cells to air (carving into existing terrain). */
  clear(region: Region | Box): void {
    this.fill(region, AIR);
  }

  get size(): number {
    return this.blocks.size;
  }

  /**
   * Sets north/east/south/west on panes, iron bars, fences and walls from
   * their neighbours, as the game does on placement (WorldEdit pastes do not
   * update neighbours, so the grid must already be right).
   */
  private connect(): void {
    const updates: [string, string][] = [];
    for (const [position, state] of this.blocks) {
      const self = connectKind(state);
      if (self !== null && self !== "solid") {
        updates.push([
          position,
          this.registry.resolve(
            withProperties(state, this.connections(position, self)),
          ),
        ]);
      }
    }
    for (const [position, state] of updates) {
      this.blocks.set(position, state);
    }
  }

  private connections(
    position: string,
    self: Connects,
  ): Record<string, string> {
    const [x, y, z] = parseKey(position);
    const on = self === "wall" ? "low" : "true";
    const off = self === "wall" ? "none" : "false";
    const props: Record<string, string> = {};
    for (const [side, dx, dz] of SIDES) {
      props[side] = joins(
        self,
        connectKind(this.blocks.get(key(x + dx, y, z + dz))),
      )
        ? on
        : off;
    }
    return props;
  }

  private bounds(): { min: Vec3; max: Vec3 } {
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (const position of this.blocks.keys()) {
      const [x, y, z] = parseKey(position);
      min.x = Math.min(min.x, x);
      min.y = Math.min(min.y, y);
      min.z = Math.min(min.z, z);
      max.x = Math.max(max.x, x);
      max.y = Math.max(max.y, y);
      max.z = Math.max(max.z, z);
    }
    return { min, max };
  }

  compile(): CompiledBuild {
    if (this.blocks.size === 0) {
      throw new Error("The build program placed no blocks");
    }
    this.connect();
    const { min, max } = this.bounds();
    const grid = new BlockGrid({
      x: max.x - min.x + 1,
      y: max.y - min.y + 1,
      z: max.z - min.z + 1,
    });
    const airCells = new Set<string>();
    for (const [position, state] of this.blocks) {
      const [x, y, z] = parseKey(position);
      grid.set(x - min.x, y - min.y, z - min.z, state);
      if (state === AIR) {
        airCells.add(key(x - min.x, y - min.y, z - min.z));
      }
    }
    return { min, grid, clears: mergeBoxes(airCells, min) };
  }
}

function rowFree(remaining: Set<string>, start: Vec3, w: number): boolean {
  for (let i = 0; i < w; i += 1) {
    if (!remaining.has(key(start.x + i, start.y, start.z))) {
      return false;
    }
  }
  return true;
}

function layerFree(
  remaining: Set<string>,
  origin: Vec3,
  w: number,
  d: number,
): boolean {
  for (let j = 0; j < d; j += 1) {
    if (!rowFree(remaining, { ...origin, z: origin.z + j }, w)) {
      return false;
    }
  }
  return true;
}

/** Grows the largest box from `origin` (x, then z, then y) and removes its cells. */
function takeBox(
  remaining: Set<string>,
  origin: Vec3,
): { w: number; h: number; d: number } {
  let w = 1;
  while (remaining.has(key(origin.x + w, origin.y, origin.z))) {
    w += 1;
  }
  let d = 1;
  while (rowFree(remaining, { ...origin, z: origin.z + d }, w)) {
    d += 1;
  }
  let h = 1;
  while (layerFree(remaining, { ...origin, y: origin.y + h }, w, d)) {
    h += 1;
  }
  for (let y = origin.y; y < origin.y + h; y += 1) {
    for (let z = origin.z; z < origin.z + d; z += 1) {
      for (let x = origin.x; x < origin.x + w; x += 1) {
        remaining.delete(key(x, y, z));
      }
    }
  }
  return { w, h, d };
}

/** Greedy merge of cells into boxes; `offset` is added to each box origin. */
export function mergeBoxes(cellsSet: Set<string>, offset: Vec3): Box[] {
  const remaining = new Set(cellsSet);
  const boxes: Box[] = [];
  const sorted = [...remaining]
    .map((position) => parseKey(position))
    .toSorted((a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0]);
  for (const [x, y, z] of sorted) {
    if (remaining.has(key(x, y, z))) {
      const size = takeBox(remaining, { x, y, z });
      boxes.push({
        x: x + offset.x,
        y: y + offset.y,
        z: z + offset.z,
        ...size,
      });
    }
  }
  return boxes;
}
