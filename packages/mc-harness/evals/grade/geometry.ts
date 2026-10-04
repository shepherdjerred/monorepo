import type { BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import type { GradeCheck } from "#evals/lib/types.ts";

/**
 * The (dx, dz) ring of a radius-4 `//hcyl`, recorded from a real WorldEdit
 * 7.4.5 run on Paper 26.2 (`//hcyl stone_bricks 4 14` at 0,-60,0, then a region
 * read of y=-50). 24 cells per layer.
 */
export const HCYL_R4_RING: readonly (readonly [number, number])[] = [
  [-4, -2],
  [-4, -1],
  [-4, 0],
  [-4, 1],
  [-4, 2],
  [-3, -3],
  [-3, 3],
  [-2, -4],
  [-2, 4],
  [-1, -4],
  [-1, 4],
  [0, -4],
  [0, 4],
  [1, -4],
  [1, 4],
  [2, -4],
  [2, 4],
  [3, -3],
  [3, 3],
  [4, -2],
  [4, -1],
  [4, 0],
  [4, 1],
  [4, 2],
];

export type TowerSpec = {
  center: { x: number; z: number };
  /** First block above ground. */
  baseY: number;
  height: number;
  wall: string;
  window: string;
  ground: string;
};

type Pos = { x: number; y: number; z: number };

/** The region a tower grader reads: center ±6, ground layer to two above the crenellations. */
export function towerBox(spec: TowerSpec): { min: Pos; max: Pos } {
  return {
    min: { x: spec.center.x - 6, y: spec.baseY - 1, z: spec.center.z - 6 },
    max: {
      x: spec.center.x + 6,
      y: spec.baseY + spec.height + 2,
      z: spec.center.z + 6,
    },
  };
}

const AIRS = new Set([
  "minecraft:air",
  "minecraft:cave_air",
  "minecraft:void_air",
]);

function blockName(state: string): string {
  const bracket = state.indexOf("[");
  return bracket === -1 ? state : state.slice(0, bracket);
}

/** World-coordinate view over a grid that covers `towerBox(spec)`. */
class TowerView {
  readonly box: { min: Pos; max: Pos };
  private readonly ring: Set<string>;

  constructor(
    private readonly grid: BlockGrid,
    readonly spec: TowerSpec,
  ) {
    this.box = towerBox(spec);
    this.ring = new Set(
      HCYL_R4_RING.map(
        ([dx, dz]) =>
          `${String(spec.center.x + dx)},${String(spec.center.z + dz)}`,
      ),
    );
  }

  at(pos: Pos): string {
    return this.grid.get(
      pos.x - this.box.min.x,
      pos.y - this.box.min.y,
      pos.z - this.box.min.z,
    );
  }

  name(pos: Pos): string {
    return blockName(this.at(pos));
  }

  solid(pos: Pos): boolean {
    return !AIRS.has(this.name(pos));
  }

  inRing(x: number, z: number): boolean {
    return this.ring.has(`${String(x)},${String(z)}`);
  }

  /** Every (x, z) column of the box at height y. */
  layer(y: number): Pos[] {
    const cells: Pos[] = [];
    for (let x = this.box.min.x; x <= this.box.max.x; x += 1) {
      for (let z = this.box.min.z; z <= this.box.max.z; z += 1) {
        cells.push({ x, y, z });
      }
    }
    return cells;
  }

  get door(): Pos[] {
    const { center, baseY } = this.spec;
    return [
      { x: center.x, y: baseY, z: center.z + 4 },
      { x: center.x, y: baseY + 1, z: center.z + 4 },
    ];
  }

  get window(): Pos[] {
    const { center, baseY } = this.spec;
    return [
      { x: center.x, y: baseY + 5, z: center.z - 4 },
      { x: center.x, y: baseY + 6, z: center.z - 4 },
    ];
  }

  get topY(): number {
    return this.spec.baseY + this.spec.height - 1;
  }
}

const samePos = (a: Pos, b: Pos): boolean =>
  a.x === b.x && a.y === b.y && a.z === b.z;

function wallChecks(view: TowerView): GradeCheck[] {
  const openings = [...view.door, ...view.window];
  const cells: Pos[] = [];
  for (let y = view.spec.baseY; y <= view.topY; y += 1) {
    cells.push(...view.layer(y));
  }
  const stray = cells.filter(
    (pos) => !view.inRing(pos.x, pos.z) && view.solid(pos),
  ).length;
  const wallCells = cells.filter(
    (pos) =>
      view.inRing(pos.x, pos.z) &&
      !openings.some((opening) => samePos(opening, pos)),
  );
  const wrongCells = wallCells.filter(
    (pos) => view.name(pos) !== view.spec.wall,
  );
  const total = wallCells.length;
  const ok = total - wrongCells.length;
  const wrong = wrongCells
    .slice(0, 5)
    .map(
      (pos) =>
        `${String(pos.x)},${String(pos.y)},${String(pos.z)}=${view.at(pos)}`,
    );
  return [
    {
      name: "wall ring",
      pass: ok === total,
      detail: `${String(ok)}/${String(total)} ${view.spec.wall}${wrong.length > 0 ? `; e.g. ${wrong.join(" ")}` : ""}`,
    },
    {
      name: "no stray blocks in tower layers",
      pass: stray === 0,
      detail: `${String(stray)} solid block(s) inside or outside the ring`,
    },
  ];
}

function openingChecks(view: TowerView): GradeCheck[] {
  const { center, baseY, wall, window } = view.spec;
  const lintel = { x: center.x, y: baseY + 2, z: center.z + 4 };
  return [
    {
      name: "doorway open, lintel intact",
      pass:
        view.door.every((pos) => !view.solid(pos)) &&
        view.name(lintel) === wall,
      detail: view.door.map((pos) => view.at(pos)).join(", "),
    },
    {
      name: "window glass",
      pass: view.window.every((pos) => view.name(pos) === window),
      detail: view.window.map((pos) => view.at(pos)).join(", "),
    },
  ];
}

function crenellationCheck(view: TowerView): GradeCheck {
  const y = view.topY + 1;
  const filled = view.layer(y).filter((pos) => view.solid(pos));
  const onRing = filled.filter((pos) => view.inRing(pos.x, pos.z));
  const adjacentPairs = onRing.filter(
    (pos) =>
      (view.inRing(pos.x + 1, pos.z) &&
        view.solid({ x: pos.x + 1, y, z: pos.z })) ||
      (view.inRing(pos.x, pos.z + 1) &&
        view.solid({ x: pos.x, y, z: pos.z + 1 })),
  ).length;
  const outside = filled.length - onRing.length;
  const ringSize = HCYL_R4_RING.length;
  return {
    name: "crenellations alternate",
    pass:
      onRing.length >= ringSize / 3 &&
      onRing.length <= (ringSize * 2) / 3 &&
      adjacentPairs <= 2 &&
      outside === 0,
    detail: `${String(onRing.length)}/${String(ringSize)} filled, ${String(adjacentPairs)} adjacent pair(s), ${String(outside)} outside the ring`,
  };
}

function envelopeChecks(view: TowerView): GradeCheck[] {
  let above = 0;
  for (let y = view.topY + 2; y <= view.box.max.y; y += 1) {
    above += view.layer(y).filter((pos) => view.solid(pos)).length;
  }
  const groundBad = view
    .layer(view.spec.baseY - 1)
    .filter((pos) => view.name(pos) !== view.spec.ground).length;
  return [
    {
      name: "nothing above the crenellations",
      pass: above === 0,
      detail: `${String(above)} solid block(s) at y≥${String(view.topY + 2)}`,
    },
    {
      name: "ground intact",
      pass: groundBad === 0,
      detail: `${String(groundBad)} ground cell(s) not ${view.spec.ground}`,
    },
  ];
}

/**
 * Grades a tower against the E1/E6 spec. `grid` covers exactly `towerBox(spec)`.
 * Pure: the caller reads the region.
 */
export function gradeTower(grid: BlockGrid, spec: TowerSpec): GradeCheck[] {
  const view = new TowerView(grid, spec);
  return [
    ...wallChecks(view),
    ...openingChecks(view),
    crenellationCheck(view),
    ...envelopeChecks(view),
  ];
}
