import { mkdir } from "node:fs/promises";
import path from "node:path";
import { compileProgram } from "@shepherdjerred/mc-build/compile/runner.ts";
import {
  gridFromRegionRead,
  type Vec3,
} from "@shepherdjerred/mc-build/core/grid.ts";
import {
  readSchematic,
  writeSchematic,
} from "@shepherdjerred/mc-build/core/schem.ts";
import { analyzeSite } from "@shepherdjerred/mc-build/core/site.ts";
import {
  lintGrid,
  type LintReport,
} from "@shepherdjerred/mc-build/lint/lint.ts";
import { loadRegistry } from "@shepherdjerred/mc-build/registry/registry.ts";
import type { BlockPos, Box } from "#protocol/bridge.ts";
import { BUILD_FILES, type Op } from "#protocol/build.ts";
import { DEFAULT_SANDBOX_TTL_SECONDS } from "#protocol/paths.ts";
import { readGrid, resetToSite, runOps } from "./ops.ts";
import { BuildWorkspace } from "./workspace.ts";
import {
  PROGRAM_TEMPLATE,
  type Env,
  plus,
  sha,
  context,
  canvasOf,
  renderGrid,
  seededSandbox,
} from "./helpers.ts";

export async function initBuild(
  dir: string,
  options: { name: string; world: string; anchor: BlockPos; seed: number },
): Promise<{ dir: string; created: string[] }> {
  const workspace = new BuildWorkspace(dir);
  if (await Bun.file(workspace.file(BUILD_FILES.manifest)).exists()) {
    throw new Error(`${workspace.dir} already has a ${BUILD_FILES.manifest}`);
  }
  await workspace.writeManifest({ version: 1, ...options });
  const created: string[] = [BUILD_FILES.manifest, BUILD_FILES.oplog];
  await workspace.writeOplog({ version: 1, ops: [] });
  if (!(await Bun.file(workspace.file(BUILD_FILES.program)).exists())) {
    await Bun.write(workspace.file(BUILD_FILES.program), PROGRAM_TEMPLATE);
    created.push(BUILD_FILES.program);
  }
  return { dir: workspace.dir, created };
}

export async function captureSite(
  env: Env,
  dir: string,
  options: { target: string; box: Box },
): Promise<{
  siteHash: string;
  size: Vec3;
  render: string;
  surface: string[];
}> {
  const workspace = new BuildWorkspace(dir);
  const manifest = await workspace.manifest();
  const snapshot = await env.client.snapshot(
    options.target,
    options.box,
    `site:${manifest.name}`,
  );
  const bytes = await env.client.snapshotBytes(options.target, snapshot.id);
  const region = await env.client.regionRead(options.target, options.box);
  const grid = gridFromRegionRead(region);
  const schematic = await readSchematic(bytes);
  if (schematic.grid.diff(grid).count > 0) {
    throw new Error(
      "The site snapshot and region read disagree; the area changed during capture. Retry.",
    );
  }
  const info = analyzeSite(grid, options.box.world, region.min);
  await mkdir(workspace.file(BUILD_FILES.siteDir), { recursive: true });
  await Bun.write(workspace.file(BUILD_FILES.siteSchematic), bytes);
  await Bun.write(
    workspace.file(BUILD_FILES.siteInfo),
    `${JSON.stringify(info)}\n`,
  );
  await workspace.writeManifest({
    ...manifest,
    world: options.box.world,
    site: { min: region.min, max: region.max, siteHash: info.siteHash },
  });
  return {
    siteHash: info.siteHash,
    size: region.size,
    render: await renderGrid(workspace, grid, "site", `${manifest.name} site`),
    surface: info.surface
      .slice(0, 5)
      .map((entry) => `${entry.state} ×${entry.count.toString()}`),
  };
}

/** Fresh void sandbox with the captured site pasted at its original coordinates. */
export async function createCanvas(
  env: Env,
  dir: string,
  options: { ttlSeconds?: number },
): Promise<{ canvas: string }> {
  const workspace = new BuildWorkspace(dir);
  const manifest = await workspace.manifest();
  const canvas = await seededSandbox(
    env,
    workspace,
    manifest,
    options.ttlSeconds ?? DEFAULT_SANDBOX_TTL_SECONDS,
  );
  await workspace.writeManifest({ ...manifest, canvas });
  return { canvas };
}

export async function compileBuild(dir: string): Promise<{
  schematic: string;
  at: BlockPos;
  size: Vec3;
  blocks: number;
  clears: number;
  logs: string[];
  lint: LintReport;
}> {
  const workspace = new BuildWorkspace(dir);
  const manifest = await workspace.manifest();
  const hasSite = await Bun.file(workspace.file(BUILD_FILES.siteInfo)).exists();
  const compiled = await compileProgram({
    program: workspace.file(BUILD_FILES.program),
    seed: manifest.seed,
    anchor: manifest.anchor,
    site: hasSite
      ? {
          info: workspace.file(BUILD_FILES.siteInfo),
          schematic: workspace.file(BUILD_FILES.siteSchematic),
        }
      : null,
  });
  const registry = await loadRegistry();
  const bytes = writeSchematic(compiled.grid, registry.dataVersion);
  const digest = sha(bytes, 12);
  const schematic = path.join(
    BUILD_FILES.schematicsDir,
    `program-${digest}.schem`,
  );
  await mkdir(workspace.file(BUILD_FILES.schematicsDir), { recursive: true });
  await Bun.write(workspace.file(schematic), bytes);
  const source = `program:${digest}`;
  const at = plus(manifest.anchor, compiled.min);
  const programOps: Op[] = [
    ...compiled.clears.map((box): Op => ({
      kind: "we",
      world: manifest.world,
      command: "//set air",
      pos1: plus(manifest.anchor, box),
      pos2: plus(manifest.anchor, {
        x: box.x + box.w - 1,
        y: box.y + box.h - 1,
        z: box.z + box.d - 1,
      }),
      source,
    })),
    {
      kind: "paste",
      world: manifest.world,
      schematic,
      at,
      rotate: 0,
      ignoreAir: true,
      source,
    },
  ];
  const log = await workspace.oplog();
  const firstProgram = log.ops.findIndex((op) =>
    op.source.startsWith("program:"),
  );
  const kept = log.ops.filter((op) => !op.source.startsWith("program:"));
  const insertAt = firstProgram === -1 ? kept.length : firstProgram;
  await workspace.writeOplog({
    version: 1,
    ops: [...kept.slice(0, insertAt), ...programOps, ...kept.slice(insertAt)],
  });
  return {
    schematic,
    at,
    size: compiled.grid.size,
    blocks: compiled.blocks,
    clears: compiled.clears.length,
    logs: compiled.logs,
    lint: lintGrid(compiled.grid, { registry, origin: at }),
  };
}

export async function runBuild(
  env: Env,
  dir: string,
  options: { target?: string },
): Promise<{ target: string; ops: number }> {
  const workspace = new BuildWorkspace(dir);
  const manifest = await workspace.manifest();
  const target = canvasOf(manifest, options.target);
  const run = context(env, workspace, manifest, target);
  const box = workspace.siteBox(manifest);
  await resetToSite(run, box);
  const { ops } = await workspace.oplog();
  await runOps(run, ops);
  // Freeze the result: promote pastes exactly this (block entities included),
  // so random WorldEdit patterns cannot drift between canvas and target.
  const snapshot = await env.client.snapshot(
    target,
    box,
    `expected:${manifest.name}`,
  );
  await Bun.write(
    workspace.file(BUILD_FILES.expectedSchematic),
    await env.client.snapshotBytes(target, snapshot.id),
  );
  await workspace.writeExpected(await env.client.regionRead(target, box));
  return { target, ops: ops.length };
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
  const inside = (["x", "y", "z"] as const).every(
    (axis) => min[axis] >= site.min[axis] && max[axis] <= site.max[axis],
  );
  if (!inside) {
    throw new Error(
      `render region ${fmtPos(min)} → ${fmtPos(max)} is outside the site ${fmtPos(site.min)} → ${fmtPos(site.max)}`,
    );
  }
  return { world: site.world, min, max };
}

function fmtPos(pos: BlockPos): string {
  return `${pos.x.toString()},${pos.y.toString()},${pos.z.toString()}`;
}

export async function renderBuild(
  env: Env,
  dir: string,
  options: {
    target?: string;
    expected?: boolean;
    name?: string;
    /** A close-up inside the site box (maps: one district at a time). */
    region?: { min: BlockPos; max: BlockPos };
  },
): Promise<{ render: string }> {
  const workspace = new BuildWorkspace(dir);
  const manifest = await workspace.manifest();
  const site = workspace.siteBox(manifest);
  if (options.region !== undefined && options.expected === true) {
    throw new Error("render a region from the canvas, not --expected");
  }
  const box =
    options.region === undefined ? site : regionInSite(site, options.region);
  const grid =
    options.expected === true
      ? await workspace.expected()
      : await readGrid(env.client, canvasOf(manifest, options.target), box);
  const name = options.name ?? `render-${Date.now().toString(36)}`;
  return { render: await renderGrid(workspace, grid, name, manifest.name) };
}

export async function lintBuild(
  env: Env,
  dir: string,
  options: { target?: string; expected?: boolean },
): Promise<LintReport> {
  const workspace = new BuildWorkspace(dir);
  const manifest = await workspace.manifest();
  const box = workspace.siteBox(manifest);
  const grid =
    options.expected === true
      ? await workspace.expected()
      : await readGrid(env.client, canvasOf(manifest, options.target), box);
  return lintGrid(grid, { registry: await loadRegistry(), origin: box.min });
}
