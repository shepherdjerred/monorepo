import { isAir, normalizeBlockState } from "./block-state.ts";
import type { RegionRead } from "./region-read.ts";

export type Vec3 = { x: number; y: number; z: number };

export const AIR = "minecraft:air";

/** A block entity kept alongside the grid (position is grid-local). */
export type GridBlockEntity = { pos: Vec3; id: string };

/**
 * A dense box of block states: a palette plus one Uint32 palette index per
 * cell in YZX order (index = (y * sizeZ + z) * sizeX + x), matching both the
 * bridge region read and Sponge schematics. Palette entries are canonical
 * state strings.
 */
export class BlockGrid {
  readonly palette: string[];
  readonly data: Uint32Array;
  private readonly lookup = new Map<string, number>();
  blockEntities: GridBlockEntity[] = [];

  constructor(
    readonly size: Vec3,
    fill = AIR,
  ) {
    if (
      ![size.x, size.y, size.z].every(
        (value) => Number.isInteger(value) && value > 0,
      )
    ) {
      throw new Error(
        `Grid size must be positive integers, got ${JSON.stringify(size)}`,
      );
    }
    this.palette = [];
    this.data = new Uint32Array(size.x * size.y * size.z);
    const index = this.paletteIndex(fill);
    if (index !== 0) {
      this.data.fill(index);
    }
  }

  get volume(): number {
    return this.data.length;
  }

  inBounds(x: number, y: number, z: number): boolean {
    return (
      x >= 0 &&
      y >= 0 &&
      z >= 0 &&
      x < this.size.x &&
      y < this.size.y &&
      z < this.size.z
    );
  }

  index(x: number, y: number, z: number): number {
    return (y * this.size.z + z) * this.size.x + x;
  }

  paletteIndex(state: string): number {
    const canonical = normalizeBlockState(state);
    const existing = this.lookup.get(canonical);
    if (existing !== undefined) {
      return existing;
    }
    const index = this.palette.length;
    this.palette.push(canonical);
    this.lookup.set(canonical, index);
    return index;
  }

  get(x: number, y: number, z: number): string {
    return this.inBounds(x, y, z)
      ? (this.palette[this.data[this.index(x, y, z)] ?? 0] ?? AIR)
      : AIR;
  }

  set(x: number, y: number, z: number, state: string): void {
    if (!this.inBounds(x, y, z)) {
      throw new Error(
        `(${x.toString()},${y.toString()},${z.toString()}) is outside the ${this.describeSize()} grid`,
      );
    }
    this.data[this.index(x, y, z)] = this.paletteIndex(state);
  }

  isAirAt(x: number, y: number, z: number): boolean {
    return isAir(this.get(x, y, z));
  }

  describeSize(): string {
    return `${this.size.x.toString()}×${this.size.y.toString()}×${this.size.z.toString()}`;
  }

  /** Visits every cell; `state` is the canonical palette string. */
  forEach(
    visit: (x: number, y: number, z: number, state: string) => void,
  ): void {
    const { x: sx, y: sy, z: sz } = this.size;
    let index = 0;
    for (let y = 0; y < sy; y += 1) {
      for (let z = 0; z < sz; z += 1) {
        for (let x = 0; x < sx; x += 1) {
          visit(x, y, z, this.palette[this.data[index] ?? 0] ?? AIR);
          index += 1;
        }
      }
    }
  }

  /** Count of each state, most common first. */
  histogram(): { state: string; count: number }[] {
    const counts = new Uint32Array(this.palette.length);
    for (const value of this.data) {
      counts[value] = (counts[value] ?? 0) + 1;
    }
    return this.palette
      .map((state, index) => ({ state, count: counts[index] ?? 0 }))
      .filter((entry) => entry.count > 0)
      .toSorted((a, b) => b.count - a.count || a.state.localeCompare(b.state));
  }

  /** A copy whose palette holds only states that occur, in first-use order. */
  compacted(): BlockGrid {
    const used: string[] = [];
    const seen = new Set<number>();
    for (const value of this.data) {
      if (!seen.has(value)) {
        seen.add(value);
        used.push(this.palette[value] ?? AIR);
      }
    }
    const out = new BlockGrid(this.size, used[0] ?? AIR);
    for (const state of used) {
      out.paletteIndex(state);
    }
    const remap = this.palette.map((state) => out.lookup.get(state) ?? 0);
    for (let index = 0; index < this.data.length; index += 1) {
      out.data[index] = remap[this.data[index] ?? 0] ?? 0;
    }
    out.blockEntities = [...this.blockEntities];
    return out;
  }

  /** Cell-by-cell comparison; returns mismatches up to `limit`. */
  diff(
    other: BlockGrid,
    limit = 100,
    /** Maps both sides before comparing, e.g. withoutNeighborDerived. */
    normalize: (state: string) => string = (state) => state,
  ): {
    count: number;
    mismatches: { at: Vec3; expected: string; actual: string }[];
  } {
    if (
      other.size.x !== this.size.x ||
      other.size.y !== this.size.y ||
      other.size.z !== this.size.z
    ) {
      throw new Error(
        `Cannot diff a ${this.describeSize()} grid with a ${other.describeSize()} grid`,
      );
    }
    const mismatches: { at: Vec3; expected: string; actual: string }[] = [];
    let count = 0;
    this.forEach((x, y, z, expected) => {
      const actual = other.get(x, y, z);
      if (actual !== expected && normalize(actual) !== normalize(expected)) {
        count += 1;
        if (mismatches.length < limit) {
          mismatches.push({ at: { x, y, z }, expected, actual });
        }
      }
    });
    return { count, mismatches };
  }

  /** Builds a grid from a palette and YZX indices (bridge or schematic). */
  static fromIndices(
    size: Vec3,
    palette: readonly string[],
    indices: ArrayLike<number>,
  ): BlockGrid {
    const volume = size.x * size.y * size.z;
    if (indices.length !== volume) {
      throw new Error(
        `Expected ${volume.toString()} block indices for ${size.x.toString()}×${size.y.toString()}×${size.z.toString()}, got ${indices.length.toString()}`,
      );
    }
    const grid = new BlockGrid(size, palette[0] ?? AIR);
    const remap = palette.map((state) => grid.paletteIndex(state));
    for (let index = 0; index < volume; index += 1) {
      const source = indices[index] ?? 0;
      const target = remap[source];
      if (target === undefined) {
        throw new Error(
          `Block index ${source.toString()} at cell ${index.toString()} is outside the ${palette.length.toString()}-entry palette`,
        );
      }
      grid.data[index] = target;
    }
    return grid;
  }
}

/** Decodes a bridge region read (base64 little-endian uint32, YZX). */
export function gridFromRegionRead(region: RegionRead): BlockGrid {
  const bytes = Buffer.from(region.blocks, "base64");
  const volume = region.size.x * region.size.y * region.size.z;
  if (bytes.length !== volume * 4) {
    throw new Error(
      `Region blocks are ${bytes.length.toString()} bytes; expected ${(volume * 4).toString()} for ${volume.toString()} cells`,
    );
  }
  const indices = new Uint32Array(volume);
  for (let index = 0; index < volume; index += 1) {
    indices[index] = bytes.readUInt32LE(index * 4);
  }
  const grid = BlockGrid.fromIndices(region.size, region.palette, indices);
  grid.blockEntities = region.blockEntities.map((entity) => ({
    id: entity.id,
    pos: {
      x: entity.pos.x - region.min.x,
      y: entity.pos.y - region.min.y,
      z: entity.pos.z - region.min.z,
    },
  }));
  return grid;
}
