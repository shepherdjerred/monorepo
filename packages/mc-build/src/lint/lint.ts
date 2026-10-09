import { isAir, parseBlockState } from "#src/core/block-state.ts";
import { type BlockGrid, FACE_NEIGHBORS, type Vec3 } from "#src/core/grid.ts";
import {
  BlockRegistryError,
  type BlockRegistry,
} from "#src/registry/registry.ts";
import {
  isGravity,
  isLeaves,
  isLog,
  isPassable,
  lightOf,
  supportOf,
} from "./physics.ts";

export type Severity = "error" | "warn" | "info";

export type Finding = {
  code: string;
  severity: Severity;
  message: string;
  /** Sample positions (grid-local unless an origin was given). */
  at: Vec3[];
  hint: string;
};

export type LintReport = {
  ok: boolean;
  errors: number;
  warnings: number;
  findings: Finding[];
  stats: {
    size: Vec3;
    blocks: number;
    palette: { state: string; count: number }[];
  };
};

export type LintOptions = {
  registry: BlockRegistry;
  /** Treat cells on the grid's bottom layer as resting on ground (default true). */
  groundedAtBottom?: boolean;
  /** Added to reported positions (e.g. the region's world min). */
  origin?: Vec3;
};

const FACING_VECTOR: Record<string, Vec3> = {
  north: { x: 0, y: 0, z: -1 },
  south: { x: 0, y: 0, z: 1 },
  east: { x: 1, y: 0, z: 0 },
  west: { x: -1, y: 0, z: 0 },
};

const SAMPLE = 5;

type Cell = {
  id: string;
  props: Readonly<Record<string, string>>;
  air: boolean;
  passable: boolean;
};

/** Shared read access to the grid for every check. */
class LintGrid {
  readonly cells: Cell[];

  constructor(
    readonly grid: BlockGrid,
    private readonly origin: Vec3,
  ) {
    this.cells = grid.palette.map((state) => {
      const parsed = parseBlockState(state);
      return {
        id: parsed.id,
        props: parsed.properties,
        air: isAir(state),
        passable: isPassable(parsed.id),
      };
    });
  }

  at(x: number, y: number, z: number): Cell | null {
    return this.grid.inBounds(x, y, z)
      ? (this.cells[this.grid.data[this.grid.index(x, y, z)] ?? 0] ?? null)
      : null;
  }

  /** true/false inside the grid; null outside (unknown). */
  solid(x: number, y: number, z: number): boolean | null {
    const cell = this.at(x, y, z);
    return cell === null ? null : !cell.air;
  }

  open(x: number, y: number, z: number): boolean {
    const cell = this.at(x, y, z);
    return cell !== null && (cell.air || cell.passable);
  }

  world(p: Vec3): Vec3 {
    return {
      x: p.x + this.origin.x,
      y: p.y + this.origin.y,
      z: p.z + this.origin.z,
    };
  }

  samples(points: readonly Vec3[]): Vec3[] {
    return points.slice(0, SAMPLE).map((point) => this.world(point));
  }

  /** Every cell position matching `test`. */
  where(test: (cell: Cell, p: Vec3) => boolean): Vec3[] {
    const found: Vec3[] = [];
    this.grid.forEach((x, y, z) => {
      const cell = this.at(x, y, z);
      if (cell !== null && test(cell, { x, y, z })) {
        found.push({ x, y, z });
      }
    });
    return found;
  }

  /** Multi-source BFS through cells accepted by `through`; returns visit order. */
  flood(
    sources: readonly Vec3[],
    through: (p: Vec3) => boolean,
    mark: Uint8Array,
  ): Vec3[] {
    const queue = [...sources];
    for (const p of queue) {
      mark[this.grid.index(p.x, p.y, p.z)] = 1;
    }
    // Iterating while pushing visits newly queued cells too (array for-of is live).
    for (const p of queue) {
      for (const n of FACE_NEIGHBORS) {
        const q = { x: p.x + n.x, y: p.y + n.y, z: p.z + n.z };
        if (
          this.grid.inBounds(q.x, q.y, q.z) &&
          mark[this.grid.index(q.x, q.y, q.z)] === 0 &&
          through(q)
        ) {
          mark[this.grid.index(q.x, q.y, q.z)] = 1;
          queue.push(q);
        }
      }
    }
    return queue;
  }
}

function checkStates(lint: LintGrid, registry: BlockRegistry): Finding[] {
  const findings: Finding[] = [];
  lint.grid.palette.forEach((state, index) => {
    if (lint.cells[index]?.air === true) {
      return;
    }
    try {
      registry.resolve(state);
    } catch (error) {
      if (!(error instanceof BlockRegistryError)) {
        throw error;
      }
      const at = lint.where(
        (_cell, p) => lint.grid.get(p.x, p.y, p.z) === state,
      );
      findings.push({
        code:
          error.code === "unknown_block" ? "E_UNKNOWN_BLOCK" : "E_BAD_STATE",
        severity: "error",
        message: error.message,
        at: lint.samples(at),
        hint:
          error.suggestions.length > 0
            ? `Try ${error.suggestions.join(", ")}`
            : "Check the registry (toolkit mc registry).",
      });
    }
  });
  return findings;
}

function checkFloating(lint: LintGrid, groundedAtBottom: boolean): Finding[] {
  const seen = new Uint8Array(lint.grid.volume);
  const findings: Finding[] = [];
  for (const start of lint.where((cell) => !cell.air)) {
    if (seen[lint.grid.index(start.x, start.y, start.z)] === 1) {
      continue;
    }
    const component = lint.flood(
      [start],
      (p) => lint.solid(p.x, p.y, p.z) === true,
      seen,
    );
    const grounded = groundedAtBottom && component.some((p) => p.y === 0);
    if (!grounded) {
      findings.push({
        code: "E_FLOATING",
        severity: "error",
        message: `${component.length.toString()} block(s) are not connected to the ground or the rest of the build`,
        at: lint.samples(component),
        hint: "Connect them with supports (posts, brackets, corbels) or remove them.",
      });
    }
  }
  return findings;
}

function supportCell(cell: Cell, p: Vec3): Vec3 | null {
  const support = supportOf(cell.id, cell.props);
  const face = cell.props["face"];
  const facing = FACING_VECTOR[cell.props["facing"] ?? ""];
  if (support === null) {
    return null;
  }
  if (support === "below" || (support === "face" && face === "floor")) {
    return { x: p.x, y: p.y - 1, z: p.z };
  }
  if (support === "above" || (support === "face" && face === "ceiling")) {
    return { x: p.x, y: p.y + 1, z: p.z };
  }
  return facing === undefined
    ? null
    : { x: p.x - facing.x, y: p.y, z: p.z - facing.z };
}

function checkSupport(lint: LintGrid): Finding[] {
  const findings: Finding[] = [];
  const falling = lint.where(
    (cell, p) =>
      isGravity(cell.id) && p.y > 0 && lint.solid(p.x, p.y - 1, p.z) === false,
  );
  if (falling.length > 0) {
    findings.push({
      code: "E_GRAVITY",
      severity: "error",
      message: `${falling.length.toString()} gravity block(s) (sand, gravel, concrete powder…) have air below and will fall`,
      at: lint.samples(falling),
      hint: "Put a solid block under them or use a non-falling block (sandstone, concrete).",
    });
  }
  const unattached = lint.where((cell, p) => {
    const need = supportCell(cell, p);
    return need !== null && lint.solid(need.x, need.y, need.z) === false;
  });
  if (unattached.length > 0) {
    const ids = new Set(
      unattached.map((p) => lint.at(p.x, p.y, p.z)?.id ?? "?"),
    );
    findings.push({
      code: "E_ATTACHMENT",
      severity: "error",
      message: `${unattached.length.toString()} attached block(s) have nothing to hang on (${[...ids].join(", ")})`,
      at: lint.samples(unattached),
      hint: "Torches, lanterns, signs, doors, plants and carpets break without their supporting block.",
    });
  }
  return findings;
}

function checkLeaves(lint: LintGrid): Finding[] {
  // Leaves survive within 6 steps (through leaves) of a log.
  const distance = new Int16Array(lint.grid.volume).fill(-1);
  const queue = lint.where((cell) => isLog(cell.id));
  for (const p of queue) {
    distance[lint.grid.index(p.x, p.y, p.z)] = 0;
  }
  for (const p of queue) {
    const d = distance[lint.grid.index(p.x, p.y, p.z)] ?? 6;
    for (const n of d >= 6 ? [] : FACE_NEIGHBORS) {
      const q = { x: p.x + n.x, y: p.y + n.y, z: p.z + n.z };
      const cell = lint.at(q.x, q.y, q.z);
      if (
        cell !== null &&
        isLeaves(cell.id) &&
        distance[lint.grid.index(q.x, q.y, q.z)] === -1
      ) {
        distance[lint.grid.index(q.x, q.y, q.z)] = d + 1;
        queue.push(q);
      }
    }
  }
  const decaying = lint.where(
    (cell, p) =>
      isLeaves(cell.id) &&
      cell.props["persistent"] === "false" &&
      distance[lint.grid.index(p.x, p.y, p.z)] === -1,
  );
  return decaying.length === 0
    ? []
    : [
        {
          code: "E_LEAVES_DECAY",
          severity: "error",
          message: `${decaying.length.toString()} non-persistent leaves are more than 6 blocks from a log and will decay`,
          at: lint.samples(decaying),
          hint: "Use persistent=true on decorative leaves (e.g. oak_leaves[persistent=true]).",
        },
      ];
}

function firstSolid(
  limit: number,
  at: (i: number) => Cell | null,
): number | null {
  for (let i = 0; i < limit; i += 1) {
    const cell = at(i);
    if (cell !== null && !cell.air && !cell.passable) {
      return i;
    }
  }
  return null;
}

function checkFacades(lint: LintGrid): Finding[] {
  const { x: sx, y: sy, z: sz } = lint.grid.size;
  const sides: {
    name: string;
    width: number;
    depth: (u: number, v: number) => number | null;
  }[] = [
    {
      name: "front (+z)",
      width: sx,
      depth: (u, v) => firstSolid(sz, (i) => lint.at(u, v, sz - 1 - i)),
    },
    {
      name: "back (-z)",
      width: sx,
      depth: (u, v) => firstSolid(sz, (i) => lint.at(u, v, i)),
    },
    {
      name: "right (+x)",
      width: sz,
      depth: (u, v) => firstSolid(sx, (i) => lint.at(sx - 1 - i, v, u)),
    },
    {
      name: "left (-x)",
      width: sz,
      depth: (u, v) => firstSolid(sx, (i) => lint.at(i, v, u)),
    },
  ];
  const findings: Finding[] = [];
  for (const side of sides) {
    const depths = new Map<number, number>();
    for (let u = 0; u < side.width; u += 1) {
      for (let v = 0; v < sy; v += 1) {
        const depth = side.depth(u, v);
        if (depth !== null) {
          depths.set(depth, (depths.get(depth) ?? 0) + 1);
        }
      }
    }
    const covered = [...depths.values()].reduce((sum, count) => sum + count, 0);
    const dominant = Math.max(0, ...depths.values());
    if (covered >= 30 && dominant / covered > 0.9) {
      findings.push({
        code: "W_FLAT_FACADE",
        severity: "warn",
        message: `The ${side.name} side is ${Math.round((dominant / covered) * 100).toString()}% one flat plane`,
        at: [],
        hint: "Add depth: proud posts and beams, recessed panels or windows, sills, a jetty or trim band.",
      });
    }
  }
  return findings;
}

function checkMonotone(lint: LintGrid): Finding[] {
  const exposed = new Map<string, number>();
  let total = 0;
  for (const p of lint.where((cell) => !cell.air)) {
    const faces = FACE_NEIGHBORS.filter(
      (n) => lint.solid(p.x + n.x, p.y + n.y, p.z + n.z) !== true,
    ).length;
    const id = lint.at(p.x, p.y, p.z)?.id ?? "";
    exposed.set(id, (exposed.get(id) ?? 0) + faces);
    total += faces;
  }
  const [topId, topFaces] = [...exposed].toSorted((a, b) => b[1] - a[1])[0] ?? [
    "",
    0,
  ];
  return total >= 50 && topFaces / total > 0.8
    ? [
        {
          code: "W_MONOTONE",
          severity: "warn",
          message: `${topId} covers ${Math.round((topFaces / total) * 100).toString()}% of the visible surface`,
          at: [],
          hint: "Mix 3–5 related blocks (texture palette or noise), and use a contrasting frame, trim and roof.",
        },
      ]
    : [];
}

/** Block light per cell (0–15) from the grid's own light sources; the renderer's `light` mode uses it. */
export function blockLightLevels(grid: BlockGrid): Int8Array {
  return blockLight(new LintGrid(grid, { x: 0, y: 0, z: 0 }));
}

function blockLight(lint: LintGrid): Int8Array {
  const light = new Int8Array(lint.grid.volume);
  const queue: Vec3[] = [];
  for (const p of lint.where((cell) => lightOf(cell.id, cell.props) > 0)) {
    const cell = lint.at(p.x, p.y, p.z);
    light[lint.grid.index(p.x, p.y, p.z)] =
      cell === null ? 0 : lightOf(cell.id, cell.props);
    queue.push(p);
  }
  for (const p of queue) {
    const level = light[lint.grid.index(p.x, p.y, p.z)] ?? 0;
    for (const n of FACE_NEIGHBORS) {
      const q = { x: p.x + n.x, y: p.y + n.y, z: p.z + n.z };
      if (
        lint.open(q.x, q.y, q.z) &&
        (light[lint.grid.index(q.x, q.y, q.z)] ?? 0) < level - 1
      ) {
        light[lint.grid.index(q.x, q.y, q.z)] = level - 1;
        queue.push(q);
      }
    }
  }
  return light;
}

function checkDarkInterior(lint: LintGrid): Finding[] {
  const { x: sx, y: sy, z: sz } = lint.grid.size;
  const outside = new Uint8Array(lint.grid.volume);
  const boundary = lint.where(
    (_cell, p) =>
      (p.x === 0 ||
        p.y === 0 ||
        p.z === 0 ||
        p.x === sx - 1 ||
        p.y === sy - 1 ||
        p.z === sz - 1) &&
      lint.open(p.x, p.y, p.z),
  );
  lint.flood(boundary, (p) => lint.open(p.x, p.y, p.z), outside);
  const light = blockLight(lint);
  const dark = lint.where((cell, p) => {
    const index = lint.grid.index(p.x, p.y, p.z);
    return (
      cell.air &&
      outside[index] === 0 &&
      light[index] === 0 &&
      p.y > 0 &&
      !lint.open(p.x, p.y - 1, p.z)
    );
  });
  return dark.length === 0
    ? []
    : [
        {
          code: "W_DARK_INTERIOR",
          severity: "warn",
          message: `${dark.length.toString()} enclosed floor cell(s) have block light 0, so hostile mobs can spawn inside`,
          at: lint.samples(dark),
          hint: "Add lanterns, torches or glowstone inside; each light reaches about 7 blocks.",
        },
      ];
}

/**
 * Checks a grid for invalid states, physics problems (floating parts,
 * unsupported gravity and attached blocks, decaying leaves) and craft smells
 * (flat facades, monotone surfaces, dark interiors).
 */
export function lintGrid(grid: BlockGrid, options: LintOptions): LintReport {
  const lint = new LintGrid(grid, options.origin ?? { x: 0, y: 0, z: 0 });
  const findings = [
    ...checkStates(lint, options.registry),
    ...checkFloating(lint, options.groundedAtBottom ?? true),
    ...checkSupport(lint),
    ...checkLeaves(lint),
    ...checkFacades(lint),
    ...checkMonotone(lint),
    ...checkDarkInterior(lint),
  ];
  const errors = findings.filter(
    (finding) => finding.severity === "error",
  ).length;
  return {
    ok: errors === 0,
    errors,
    warnings: findings.filter((finding) => finding.severity === "warn").length,
    findings,
    stats: {
      size: grid.size,
      blocks: lint.where((cell) => !cell.air).length,
      palette: grid
        .histogram()
        .filter((entry) => !isAir(entry.state))
        .slice(0, 12),
    },
  };
}
