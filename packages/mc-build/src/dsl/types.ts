/**
 * Build DSL frame: +x is right, +y is up, +z points toward the front of the
 * build. Placed with rotate 0, the front faces south (+z in world space), so
 * "front" = south, "back" = north, "right" = east and "left" = west.
 * Boxes are always an origin plus a size, never two corners.
 */
export type Dir = "front" | "back" | "left" | "right";
export type Face = Dir | "up" | "down";
export type Vec3 = { x: number; y: number; z: number };
export type Box = {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
};

/** A block state string, or a function choosing one per local cell. */
export type Material = string | ((x: number, y: number, z: number) => string);

/** Leave the world untouched here (the default for every cell). */
export const KEEP = "mcbuild:keep";
/** Explicitly clear this cell to air, even over existing terrain. */
export const AIR = "minecraft:air";

export const WORLD_FACING: Record<Dir, "south" | "north" | "east" | "west"> = {
  front: "south",
  back: "north",
  right: "east",
  left: "west",
};

export const OPPOSITE: Record<Dir, Dir> = {
  front: "back",
  back: "front",
  left: "right",
  right: "left",
};

/** One cell set: anything iterable over local positions plus membership. */
export type Region = {
  readonly bounds: Box;
  has: (x: number, y: number, z: number) => boolean;
};

/** Terrain around the build, in local coordinates (only for rotate 0). */
export type Site = {
  /** First free y above the terrain at (x, z), or null outside the capture. */
  heightAt: (x: number, z: number) => number | null;
  /** Captured block at a local position, or null outside the capture. */
  blockAt: (x: number, y: number, z: number) => string | null;
};
