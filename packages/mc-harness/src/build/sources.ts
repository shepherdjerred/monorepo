/**
 * Where `build render` and `build lint` get their blocks: the live canvas,
 * the frozen `expected` result, or the captured site with the op log's
 * paste ops applied offline.
 */
import path from "node:path";
import { AIR, type BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import { readSchematic } from "@shepherdjerred/mc-build/core/schem.ts";
import { gridHash } from "@shepherdjerred/mc-build/core/site.ts";
import type { BlockPos, Box } from "#protocol/bridge.ts";
import { BUILD_FILES, type BuildManifest, type Op } from "#protocol/build.ts";
import { canvasOf, type Env, type LookOptions } from "./helpers.ts";
import { readGrid } from "./ops.ts";
import { buildArtifactPath, readSidecar } from "./sidecar.ts";
import { cropGrid } from "./tiles.ts";
import type { BuildWorkspace } from "./workspace.ts";
import { readRenderContext } from "./render-context.ts";

/**
 * Where a render or lint reads its blocks: the live canvas (default), the
 * frozen `expected` result of the last run, or `compiled` — the captured site
 * with the op log's paste ops applied offline, which needs no sandbox and
 * makes `compile → render → lint` a local loop for DSL builds.
 */
export type RenderSource = "canvas" | "expected" | "compiled";

/** Pastes `source` into `target` at `offset`, clipped to `target`, honouring `ignoreAir`. */
function pasteInto(
  target: BlockGrid,
  source: BlockGrid,
  offset: BlockPos,
  ignoreAir: boolean,
): void {
  source.forEach((x, y, z, state) => {
    if (ignoreAir && source.isAirAt(x, y, z)) return;
    const tx = x + offset.x;
    const ty = y + offset.y;
    const tz = z + offset.z;
    if (target.inBounds(tx, ty, tz)) target.set(tx, ty, tz, state);
  });
}

const CLEAR_COMMANDS = new Set(["//set air", "//set minecraft:air"]);

/** Fills a world-space box with air, clipped to the grid. */
function clearBox(
  grid: BlockGrid,
  siteMin: BlockPos,
  a: BlockPos,
  b: BlockPos,
): void {
  const lo = {
    x: Math.min(a.x, b.x) - siteMin.x,
    y: Math.min(a.y, b.y) - siteMin.y,
    z: Math.min(a.z, b.z) - siteMin.z,
  };
  const hi = {
    x: Math.max(a.x, b.x) - siteMin.x,
    y: Math.max(a.y, b.y) - siteMin.y,
    z: Math.max(a.z, b.z) - siteMin.z,
  };
  for (
    let y = Math.max(lo.y, 0);
    y <= Math.min(hi.y, grid.size.y - 1);
    y += 1
  ) {
    for (
      let z = Math.max(lo.z, 0);
      z <= Math.min(hi.z, grid.size.z - 1);
      z += 1
    ) {
      for (
        let x = Math.max(lo.x, 0);
        x <= Math.min(hi.x, grid.size.x - 1);
        x += 1
      ) {
        grid.set(x, y, z, AIR);
      }
    }
  }
}

/** Applies one op offline when it can be; returns why not otherwise. */
async function applyOffline(
  workspace: BuildWorkspace,
  grid: BlockGrid,
  site: Box,
  op: Op,
): Promise<string | null> {
  if (op.kind !== "command" && op.world !== site.world) {
    return `targets world "${op.world}", not captured world "${site.world}"`;
  }
  const siteMin = site.min;
  if (op.kind === "we") {
    if (
      CLEAR_COMMANDS.has(op.command) &&
      op.pos1 !== undefined &&
      op.pos2 !== undefined
    ) {
      clearBox(grid, siteMin, op.pos1, op.pos2);
      return null;
    }
    return "only a server can run it";
  }
  if (op.kind === "command") return "only a server can run it";
  if (op.rotate !== 0)
    return `rotated ${op.rotate.toString()}°, not applied offline`;
  const bytes = new Uint8Array(
    await Bun.file(
      await buildArtifactPath(workspace, op.schematic),
    ).arrayBuffer(),
  );
  const schematic = await readSchematic(bytes);
  pasteInto(
    grid,
    schematic.grid,
    { x: op.at.x - siteMin.x, y: op.at.y - siteMin.y, z: op.at.z - siteMin.z },
    op.ignoreAir,
  );
  return null;
}

/**
 * The site with the op log applied offline: paste ops and the compiler's
 * `//set air` clear boxes, which is everything a DSL build emits, so its
 * picture is exact. Other WorldEdit and console ops only run on a server,
 * and rotated pastes need block-state rotation the offline path does not do
 * yet; those are returned as `skipped` so the caller can say what the
 * picture lacks.
 */
export async function compiledGrid(
  workspace: BuildWorkspace,
  manifest: BuildManifest,
  savedOps?: readonly Op[],
): Promise<{ grid: BlockGrid; skipped: string[] }> {
  const site = workspace.siteBox(manifest);
  const grid = await workspace.siteGrid();
  if (gridHash(grid) !== manifest.site?.siteHash) {
    throw new Error(
      "captured site schematic does not match build.json siteHash; capture the site again",
    );
  }
  const oplog =
    savedOps === undefined ? await workspace.oplog() : { ops: savedOps };
  const skipped: string[] = [];
  for (const [index, op] of oplog.ops.entries()) {
    const reason = await applyOffline(workspace, grid, site, op);
    if (reason !== null) {
      skipped.push(
        `op ${(index + 1).toString()} (${op.kind}, ${op.source}): ${reason}`,
      );
    }
  }
  return { grid, skipped };
}

/** The part of a site-sized grid inside `box` (a district of a map); the whole grid for the site box itself. */
export function cropToBox(
  grid: BlockGrid,
  site: { min: BlockPos; max: BlockPos },
  box: { min: BlockPos; max: BlockPos },
): BlockGrid {
  const axes = ["x", "y", "z"] as const;
  if (
    axes.every(
      (axis) =>
        box.min[axis] === site.min[axis] && box.max[axis] === site.max[axis],
    )
  ) {
    return grid;
  }
  return cropGrid(
    grid,
    {
      x: box.min.x - site.min.x,
      y: box.min.y - site.min.y,
      z: box.min.z - site.min.z,
    },
    {
      x: box.max.x - box.min.x + 1,
      y: box.max.y - box.min.y + 1,
      z: box.max.z - box.min.z + 1,
    },
  );
}

export async function gridFor(
  env: Env,
  workspace: BuildWorkspace,
  manifest: BuildManifest,
  options: { source: RenderSource; target?: string; box: Box },
): Promise<{ grid: BlockGrid; skipped: string[] }> {
  const site = workspace.siteBox(manifest);
  switch (options.source) {
    case "expected":
      return {
        grid: cropToBox(await workspace.expected(), site, options.box),
        skipped: [],
      };
    case "compiled": {
      const compiled = await compiledGrid(workspace, manifest);
      return { ...compiled, grid: cropToBox(compiled.grid, site, options.box) };
    }
    case "canvas":
      return {
        grid: await readGrid(
          env.client,
          canvasOf(manifest, options.target),
          options.box,
        ),
        skipped: [],
      };
  }
}

/** An earlier render's saved grid, for `--compare`. */
export async function savedRender(
  workspace: BuildWorkspace,
  name: string,
): Promise<BlockGrid> {
  const earlier = workspace.file(
    path.join(BUILD_FILES.rendersDir, `${name}.schem`),
  );
  if (!(await Bun.file(earlier).exists())) {
    throw new Error(
      `no grid saved for render "${name}" (${earlier}); only renders made with this version keep one`,
    );
  }
  const schematic = await readSchematic(
    new Uint8Array(await Bun.file(earlier).arrayBuffer()),
  );
  return schematic.grid;
}

/**
 * An earlier render's grid, cut to the world box of the render being made:
 * the same box gives the grid as saved; a box inside the earlier render's
 * (a district of a map rendered whole) gives that part; anything else, or
 * a render made before boxes were recorded, cannot be compared.
 */
export async function alignedRender(
  workspace: BuildWorkspace,
  name: string,
  box: { min: BlockPos; max: BlockPos },
): Promise<BlockGrid> {
  const sidecar = await readSidecar(workspace, name);
  const saved = await savedRender(workspace, name);
  if (gridHash(saved) !== sidecar.gridHash) {
    throw new Error(
      `render "${name}" schematic hash does not match its sidecar; render it again before comparing`,
    );
  }
  const covered = sidecar.box;
  if (covered === undefined) {
    throw new Error(
      `render "${name}" does not record the region it covers; render it again before comparing against it`,
    );
  }
  const axes = ["x", "y", "z"] as const;
  const inside = axes.every(
    (axis) =>
      box.min[axis] >= covered.min[axis] && box.max[axis] <= covered.max[axis],
  );
  if (!inside) {
    throw new Error(
      `render "${name}" covers ${fmtBox(covered)}, not the region ${fmtBox(box)} being rendered; compare against a render of the same region`,
    );
  }
  const offset = {
    x: box.min.x - covered.min.x,
    y: box.min.y - covered.min.y,
    z: box.min.z - covered.min.z,
  };
  const size = {
    x: box.max.x - box.min.x + 1,
    y: box.max.y - box.min.y + 1,
    z: box.max.z - box.min.z + 1,
  };
  const same = axes.every(
    (axis) => offset[axis] === 0 && size[axis] === saved.size[axis],
  );
  return same ? saved : cropGrid(saved, offset, size);
}

/** Align both the selected blocks and the archived shading origin. */
export async function alignedComparison(
  workspace: BuildWorkspace,
  name: string,
  box: { min: BlockPos; max: BlockPos },
) {
  const grid = await alignedRender(workspace, name, box);
  const sidecar = await readSidecar(workspace, name);
  const context = await readRenderContext(
    workspace,
    sidecar,
    await savedRender(workspace, name),
  );
  if (sidecar.box === undefined) throw new Error("missing comparison box");
  return {
    grid,
    context: {
      grid: context.grid,
      origin: {
        x: context.origin.x + box.min.x - sidecar.box.min.x,
        y: context.origin.y + box.min.y - sidecar.box.min.y,
        z: context.origin.z + box.min.z - sidecar.box.min.z,
      },
    },
  };
}

export function regionInSite(
  site: Box,
  region: { min: BlockPos; max: BlockPos },
): Box {
  const min = {
    x: Math.min(region.min.x, region.max.x),
    y: Math.min(region.min.y, region.max.y),
    z: Math.min(region.min.z, region.max.z),
  };
  const max = {
    x: Math.max(region.min.x, region.max.x),
    y: Math.max(region.min.y, region.max.y),
    z: Math.max(region.min.z, region.max.z),
  };
  if (
    (["x", "y", "z"] as const).some(
      (axis) => min[axis] < site.min[axis] || max[axis] > site.max[axis],
    )
  )
    throw new Error(
      `render region ${fmtBox({ min, max })} is outside the site ${fmtBox(site)}`,
    );
  return { world: site.world, min, max };
}

function fmtBox(box: { min: BlockPos; max: BlockPos }): string {
  const pos = (p: BlockPos): string =>
    `${p.x.toString()},${p.y.toString()},${p.z.toString()}`;
  return `${pos(box.min)} → ${pos(box.max)}`;
}

/** True when nothing beyond the default contact sheet (and hero) was asked for. */
export function isPlainLook(look: LookOptions): boolean {
  return (
    look.mode === undefined &&
    look.views === undefined &&
    look.grid === undefined &&
    look.floor === undefined &&
    look.section === undefined &&
    look.crop === undefined &&
    look.compareWith === undefined
  );
}
