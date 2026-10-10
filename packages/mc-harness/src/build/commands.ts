import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { compileProgram } from "@shepherdjerred/mc-build/compile/runner.ts";
import {
  gridFromRegionRead,
  type BlockGrid,
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
import { appendLog } from "./build-log.ts";
import {
  checkName,
  producingProgram,
  programSnapshot,
  readRenderProvenance,
} from "./sidecar.ts";
import {
  alignedComparison,
  cropToBox,
  gridFor,
  isPlainLook,
  regionInSite,
  type RenderSource,
} from "./sources.ts";
import { DEFAULT_SANDBOX_TTL_SECONDS } from "#protocol/paths.ts";
import { resetToSite, runOps } from "./ops.ts";
import { boxSize, cropGrid, emptyGrid, placeGrid, tileBox } from "./tiles.ts";
import { BuildWorkspace } from "./workspace.ts";
import { validateFrozenExpected, type FrozenPart } from "./frozen-expected.ts";
import {
  PROGRAM_TEMPLATE,
  type Env,
  plus,
  sha,
  context,
  canvasOf,
  renderGrid,
  localCuts,
  recordRender,
  relativeFiles,
  renderHero,
  renderLooks,
  seededSandbox,
  type LookOptions,
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
  const parts = await snapshotFrozen(
    env,
    options.target,
    options.box,
    `site:${manifest.name}`,
  );
  const region = await env.client.regionRead(options.target, options.box);
  const grid = gridFromRegionRead(region);
  const snapshotted = emptyGrid(grid.size);
  let dataVersion = 0;
  for (const part of parts) {
    const schematic = await readSchematic(part.bytes);
    dataVersion = schematic.dataVersion;
    placeGrid(snapshotted, schematic.grid, {
      x: part.at.x - options.box.min.x,
      y: part.at.y - options.box.min.y,
      z: part.at.z - options.box.min.z,
    });
  }
  if (snapshotted.diff(grid).count > 0) {
    throw new Error(
      "The site snapshot and region read disagree; the area changed during capture. Retry.",
    );
  }
  const info = analyzeSite(grid, options.box.world, region.min);
  await mkdir(workspace.file(BUILD_FILES.siteDir), { recursive: true });
  await workspace.writeFrozen(
    "site",
    parts,
    parts.length > 1 ? writeSchematic(grid, dataVersion) : undefined,
  );
  await Bun.write(
    workspace.file(BUILD_FILES.siteInfo),
    `${JSON.stringify(info)}\n`,
  );
  // A new capture starts a new competition; retain old candidates for inspection.
  const {
    best: _best,
    knockout: _knockout,
    canvas: _canvas,
    ...capturedManifest
  } = manifest;
  await workspace.writeManifest({
    ...capturedManifest,
    world: options.box.world,
    site: { min: region.min, max: region.max, siteHash: info.siteHash },
  });
  await appendLog(dir, {
    kind: "capture",
    siteHash: info.siteHash,
    box: options.box,
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

/**
 * The program's paste ops: the whole schematic, or (map-scale output over the
 * bridge volume limit) one schematic per column tile so each paste stays small.
 */
async function programPastes(
  workspace: BuildWorkspace,
  grid: BlockGrid,
  options: {
    digest: string;
    whole: string;
    at: BlockPos;
    world: string;
    dataVersion: number;
  },
): Promise<{ schematic: string; at: BlockPos }[]> {
  const local = {
    world: options.world,
    min: { x: 0, y: 0, z: 0 },
    max: { x: grid.size.x - 1, y: grid.size.y - 1, z: grid.size.z - 1 },
  };
  const tiles = tileBox(local);
  if (tiles.length === 1) {
    return [{ schematic: options.whole, at: options.at }];
  }
  const pastes = [];
  for (const [n, tile] of tiles.entries()) {
    const schematic = path.join(
      BUILD_FILES.schematicsDir,
      `program-${options.digest}-${n.toString()}.schem`,
    );
    await Bun.write(
      workspace.file(schematic),
      writeSchematic(
        cropGrid(grid, tile.min, boxSize(tile)),
        options.dataVersion,
      ),
    );
    pastes.push({ schematic, at: plus(options.at, tile.min) });
  }
  return pastes;
}

export async function compileBuild(dir: string): Promise<{
  schematic: string;
  at: BlockPos;
  size: Vec3;
  blocks: number;
  clears: number;
  ops: number;
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
  // Keyed by the program text as well as its output: two texts that compile
  // to the same blocks keep separate snapshots, so `program-<digest>.build.ts`
  // is always the text that produced that digest, never a later edit.
  const programBytes = await Bun.file(
    workspace.file(BUILD_FILES.program),
  ).bytes();
  const digest = sha(`${sha(programBytes)}\n${sha(bytes)}`, 12);
  const schematic = path.join(
    BUILD_FILES.schematicsDir,
    `program-${digest}.schem`,
  );
  await mkdir(workspace.file(BUILD_FILES.schematicsDir), { recursive: true });
  await Bun.write(workspace.file(schematic), bytes);
  // The program as compiled, kept with its output so a render can say
  // which text produced the blocks even after build.ts is edited again.
  await cp(
    workspace.file(BUILD_FILES.program),
    workspace.file(programSnapshot(digest)),
  );
  const source = `program:${digest}`;
  const at = plus(manifest.anchor, compiled.min);
  const pastes = await programPastes(workspace, compiled.grid, {
    digest,
    whole: schematic,
    at,
    world: manifest.world,
    dataVersion: registry.dataVersion,
  });
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
    ...pastes.map((paste): Op => ({
      kind: "paste",
      world: manifest.world,
      schematic: paste.schematic,
      at: paste.at,
      rotate: 0,
      ignoreAir: true,
      source,
    })),
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
    ops: programOps.length,
    logs: compiled.logs,
    lint: lintGrid(compiled.grid, { registry, origin: at }),
  };
}

/** Snapshots `box` (in tiles when it exceeds the bridge limit) as pasteable parts. */
async function snapshotFrozen(
  env: Env,
  target: string,
  box: Box,
  label: string,
): Promise<FrozenPart[]> {
  const { parts } = await env.client.snapshotParts(target, box, label);
  const frozen: FrozenPart[] = [];
  for (const part of parts) {
    frozen.push({
      at: part.box.min,
      bytes: await env.client.snapshotBytes(target, part.id),
    });
  }
  return frozen;
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
  const { ops } = await workspace.oplog();
  const program = await producingProgram(workspace, ops);
  await resetToSite(run, box);
  await runOps(run, ops);
  // Freeze the result: promote pastes exactly this (block entities included),
  // so random WorldEdit patterns cannot drift between canvas and target.
  const frozen = await snapshotFrozen(
    env,
    target,
    box,
    `expected:${manifest.name}`,
  );
  const region = await env.client.regionRead(target, box);
  await validateFrozenExpected(box, region, frozen);
  await workspace.writeFrozen("expected", frozen);
  await workspace.writeExpected(region);
  await appendLog(dir, {
    kind: "run",
    target,
    ops: ops.length,
    program,
  });
  return { target, ops: ops.length };
}

export async function renderBuild(
  env: Env,
  dir: string,
  options: {
    target?: string;
    source?: RenderSource;
    /** Same as `source: "expected"`; kept for older callers. */
    expected?: boolean;
    name?: string;
    /** A close-up inside the site box (maps: one district at a time). */
    region?: { min: BlockPos; max: BlockPos };
    look?: LookOptions;
    /** Name of an earlier render whose `.schem` sidecar to compare against. */
    compare?: string;
  },
): Promise<{
  render: string;
  hero: string | null;
  files: Record<string, string>;
  skipped: string[];
}> {
  const workspace = new BuildWorkspace(dir);
  const manifest = await workspace.manifest();
  const site = workspace.siteBox(manifest);
  const source: RenderSource =
    options.source ?? (options.expected === true ? "expected" : "canvas");
  const box =
    options.region === undefined ? site : regionInSite(site, options.region);
  const { grid: whole, skipped } = await gridFor(env, workspace, manifest, {
    source,
    box: site,
    ...(options.target === undefined ? {} : { target: options.target }),
  });
  const grid = cropToBox(whole, site, box);
  if (skipped.length > 0) {
    throw new Error(
      `cannot render incomplete compiled evidence: ${skipped.join("; ")}; run the build and render --source expected or --source canvas`,
    );
  }
  const name = checkName(
    "render",
    options.name ?? `render-${Date.now().toString(36)}`,
  );
  const look: LookOptions = localCuts(
    { ...options.look },
    manifest.anchor,
    box.min,
  );
  const covered = { min: box.min, max: box.max };
  if (options.compare !== undefined) {
    const earlier = await alignedComparison(
      workspace,
      options.compare,
      covered,
    );
    look.compareWith = earlier.grid;
    look.compareContext = earlier.context;
  }
  look.source = source;
  if (options.target !== undefined) look.target = options.target;
  look.box = covered;
  if (options.region !== undefined) {
    look.regionContext = {
      grid: whole,
      origin: {
        x: box.min.x - site.min.x,
        y: box.min.y - site.min.y,
        z: box.min.z - site.min.z,
      },
    };
  }
  if (isPlainLook(look) && options.region === undefined) {
    const provenance = await readRenderProvenance(
      workspace,
      source,
      options.target,
    );
    const render = await renderGrid(workspace, grid, name, manifest.name);
    const hero = await renderHero(workspace, grid, name);
    const files = { sheet: render, ...(hero === null ? {} : { hero }) };
    await recordRender(workspace, grid, {
      name,
      files,
      source,
      provenance,
      box: covered,
    });
    await appendLog(dir, {
      kind: "render",
      name,
      source,
      files: Object.values(relativeFiles(workspace, files)),
    });
    return { render, hero, files, skipped };
  }
  const files = await renderLooks(workspace, grid, name, look);
  await appendLog(dir, {
    kind: "render",
    name,
    source,
    files: Object.values(relativeFiles(workspace, files)),
  });
  return {
    render:
      files["sheet"] ?? files["elevations"] ?? Object.values(files)[0] ?? "",
    hero: files["hero"] ?? null,
    files,
    skipped,
  };
}

export async function lintBuild(
  env: Env,
  dir: string,
  options: { target?: string; source?: RenderSource; expected?: boolean },
): Promise<LintReport & { skipped: string[] }> {
  const workspace = new BuildWorkspace(dir);
  const manifest = await workspace.manifest();
  const box = workspace.siteBox(manifest);
  const source: RenderSource =
    options.source ?? (options.expected === true ? "expected" : "canvas");
  const { grid, skipped } = await gridFor(env, workspace, manifest, {
    source,
    box,
    ...(options.target === undefined ? {} : { target: options.target }),
  });
  const report = lintGrid(grid, {
    registry: await loadRegistry(),
    origin: box.min,
  });
  await appendLog(dir, {
    kind: "lint",
    source,
    errors: report.errors,
    warnings: report.warnings,
  });
  return { ...report, skipped };
}
