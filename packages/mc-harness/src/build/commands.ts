import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { compileProgram } from "@shepherdjerred/mc-build/compile/runner.ts";
import { gridFromRegionRead, type BlockGrid, type Vec3 } from "@shepherdjerred/mc-build/core/grid.ts";
import { isAir } from "@shepherdjerred/mc-build/core/block-state.ts";
import { readLitematic } from "@shepherdjerred/mc-build/core/litematic.ts";
import { readSchematic, writeSchematic } from "@shepherdjerred/mc-build/core/schem.ts";
import { analyzeSite, gridHash } from "@shepherdjerred/mc-build/core/site.ts";
import { importMesh } from "@shepherdjerred/mc-build/import/mesh.ts";
import { loadPalette, type PaletteName } from "@shepherdjerred/mc-build/import/palette.ts";
import { lintGrid, type LintReport } from "@shepherdjerred/mc-build/lint/lint.ts";
import { loadRegistry } from "@shepherdjerred/mc-build/registry/registry.ts";
import { ensureAssets } from "@shepherdjerred/mc-build/render/assets.ts";
import { encodePng, Renderer } from "@shepherdjerred/mc-build/render/index.ts";
import type { BlockPos, Box, Rotation } from "#protocol/bridge.ts";
import { BUILD_FILES, type BuildManifest, type Op } from "#protocol/build.ts";
import { DEFAULT_SANDBOX_TTL_SECONDS } from "#protocol/paths.ts";
import type { DaemonClient } from "./daemon-client.ts";
import { Journal, type JournalEntry } from "./journal.ts";
import { diffGrids, readGrid, resetToSite, runOps, type GridDiff, type RunContext } from "./ops.ts";
import { BuildWorkspace } from "./workspace.ts";

export const PROGRAM_TEMPLATE = `import type { BuildProgram } from "@shepherdjerred/mc-build/dsl/context.ts";

/**
 * Build program: local frame +x right, +y up, +z toward the front (south at
 * rotate 0). (0,0,0) is the manifest anchor. Boxes are {x, y, z, w, h, d}.
 * Run \`toolkit mc build compile <dir>\` to turn this into a paste op.
 */
export default ((ctx) => {
  const { craft, mat } = ctx;
  const theme = mat.theme("medieval");
  const fp = { x: 0, z: 0, w: 9, d: 7 };
  const base = craft.foundation({ ...fp, y: 0, material: theme.foundation });
  const walls = craft.walls({ ...fp, y: base.top, h: 4, frame: theme.frame, infill: theme.infill });
  craft.door(walls.faces.front, { at: 4, door: theme.door });
  craft.gableRoof({ ...fp, y: walls.top, ridge: "x", stairs: theme.roof, gable: theme.trim, eaves: true });
}) satisfies BuildProgram;
`;

export type Env = { client: DaemonClient; journal: Journal; log: (message: string) => void };

function plus(a: BlockPos, b: Vec3): BlockPos {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function sha(bytes: Uint8Array | string, length = 16): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, length);
}

function context(env: Env, workspace: BuildWorkspace, manifest: BuildManifest, target: string): RunContext {
  return { client: env.client, target, workspace, session: BuildWorkspace.session(manifest) };
}

function canvasOf(manifest: BuildManifest, explicit: string | undefined): string {
  const target = explicit ?? manifest.canvas;
  if (target === undefined) {
    throw new Error("No target: pass --target <sandbox> or create a canvas with toolkit mc build canvas <dir>");
  }
  return target;
}

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

async function renderGrid(workspace: BuildWorkspace, grid: BlockGrid, name: string, title: string): Promise<string> {
  const renderer = new Renderer(await ensureAssets(undefined, (message) => {
    console.error(message);
  }));
  const image = await renderer.sheet(grid, { title, subtitle: name });
  await mkdir(workspace.file(BUILD_FILES.rendersDir), { recursive: true });
  const out = workspace.file(path.join(BUILD_FILES.rendersDir, `${name}.png`));
  await Bun.write(out, await encodePng(image));
  return out;
}

export async function captureSite(
  env: Env,
  dir: string,
  options: { target: string; box: Box },
): Promise<{ siteHash: string; size: Vec3; render: string; surface: string[] }> {
  const workspace = new BuildWorkspace(dir);
  const manifest = await workspace.manifest();
  const snapshot = await env.client.snapshot(options.target, options.box, `site:${manifest.name}`);
  const bytes = await env.client.snapshotBytes(options.target, snapshot.id);
  const region = await env.client.regionRead(options.target, options.box);
  const grid = gridFromRegionRead(region);
  const schematic = await readSchematic(bytes);
  if (schematic.grid.diff(grid).count > 0) {
    throw new Error("The site snapshot and region read disagree; the area changed during capture. Retry.");
  }
  const info = analyzeSite(grid, options.box.world, region.min);
  await mkdir(workspace.file(BUILD_FILES.siteDir), { recursive: true });
  await Bun.write(workspace.file(BUILD_FILES.siteSchematic), bytes);
  await Bun.write(workspace.file(BUILD_FILES.siteInfo), `${JSON.stringify(info)}\n`);
  await workspace.writeManifest({
    ...manifest,
    world: options.box.world,
    site: { min: region.min, max: region.max, siteHash: info.siteHash },
  });
  return {
    siteHash: info.siteHash,
    size: region.size,
    render: await renderGrid(workspace, grid, "site", `${manifest.name} site`),
    surface: info.surface.slice(0, 5).map((entry) => `${entry.state} ×${entry.count.toString()}`),
  };
}

/** Fresh void sandbox with the captured site pasted at its original coordinates. */
async function seededSandbox(env: Env, workspace: BuildWorkspace, manifest: BuildManifest, ttlSeconds: number): Promise<string> {
  env.log("booting a void sandbox…");
  const sandbox = await env.client.createSandbox({ profile: "paper", world: "void", ttlSeconds, keep: false });
  await resetToSite(context(env, workspace, manifest, sandbox.id), workspace.siteBox(manifest));
  return sandbox.id;
}

export async function createCanvas(env: Env, dir: string, options: { ttlSeconds?: number }): Promise<{ canvas: string }> {
  const workspace = new BuildWorkspace(dir);
  const manifest = await workspace.manifest();
  const canvas = await seededSandbox(env, workspace, manifest, options.ttlSeconds ?? DEFAULT_SANDBOX_TTL_SECONDS);
  await workspace.writeManifest({ ...manifest, canvas });
  return { canvas };
}

export async function compileBuild(
  dir: string,
): Promise<{ schematic: string; at: BlockPos; size: Vec3; blocks: number; clears: number; logs: string[]; lint: LintReport }> {
  const workspace = new BuildWorkspace(dir);
  const manifest = await workspace.manifest();
  const hasSite = await Bun.file(workspace.file(BUILD_FILES.siteInfo)).exists();
  const compiled = await compileProgram({
    program: workspace.file(BUILD_FILES.program),
    seed: manifest.seed,
    anchor: manifest.anchor,
    site: hasSite ? { info: workspace.file(BUILD_FILES.siteInfo), schematic: workspace.file(BUILD_FILES.siteSchematic) } : null,
  });
  const registry = await loadRegistry();
  const bytes = writeSchematic(compiled.grid, registry.dataVersion);
  const digest = sha(bytes, 12);
  const schematic = path.join(BUILD_FILES.schematicsDir, `program-${digest}.schem`);
  await mkdir(workspace.file(BUILD_FILES.schematicsDir), { recursive: true });
  await Bun.write(workspace.file(schematic), bytes);
  const source = `program:${digest}`;
  const at = plus(manifest.anchor, compiled.min);
  const programOps: Op[] = [
    ...compiled.clears.map(
      (box): Op => ({
        kind: "we",
        world: manifest.world,
        command: "//set air",
        pos1: plus(manifest.anchor, box),
        pos2: plus(manifest.anchor, { x: box.x + box.w - 1, y: box.y + box.h - 1, z: box.z + box.d - 1 }),
        source,
      }),
    ),
    { kind: "paste", world: manifest.world, schematic, at, rotate: 0, ignoreAir: true, source },
  ];
  const log = await workspace.oplog();
  const firstProgram = log.ops.findIndex((op) => op.source.startsWith("program:"));
  const kept = log.ops.filter((op) => !op.source.startsWith("program:"));
  const insertAt = firstProgram === -1 ? kept.length : firstProgram;
  await workspace.writeOplog({ version: 1, ops: [...kept.slice(0, insertAt), ...programOps, ...kept.slice(insertAt)] });
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

export type ImportOptions = {
  at?: BlockPos;
  rotate: Rotation;
  /** Mesh only: model height in blocks. */
  height?: number;
  /** Mesh only: fill enclosed space. */
  solid: boolean;
  /** Mesh only: blocks to match colors against. */
  palette: PaletteName;
};

/** Loads a `.litematic`, `.schem` or `.obj` mesh as a grid plus a description for logs. */
async function loadImport(file: string, options: ImportOptions): Promise<{ grid: BlockGrid; description: string }> {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".litematic") {
    const info = await readLitematic(new Uint8Array(await Bun.file(file).arrayBuffer()));
    const regions = info.regions.length.toString();
    return { grid: info.grid, description: `litematic "${info.name}" by ${info.author || "unknown"} (${regions} region(s))` };
  }
  if (extension === ".schem") {
    const info = await readSchematic(new Uint8Array(await Bun.file(file).arrayBuffer()));
    return { grid: info.grid, description: "Sponge schematic" };
  }
  if (extension === ".obj") {
    if (options.height === undefined) {
      throw new Error("Mesh import needs --height <blocks>");
    }
    const assets = await ensureAssets(undefined, (message) => {
      console.error(message);
    });
    const result = await importMesh(file, {
      height: options.height,
      solid: options.solid,
      palette: await loadPalette(options.palette, assets),
    });
    return {
      grid: result.grid,
      description: `mesh: ${result.triangles.toString()} triangles → ${result.surface.toString()} surface + ${result.interior.toString()} interior voxels (${options.palette} palette)`,
    };
  }
  throw new Error(`Cannot import ${file}: expected .litematic, .schem or .obj`);
}

/**
 * Imports an external build: writes it as a schematic, appends a paste op
 * (min corner at `at`, default the manifest anchor), lints it and renders a
 * preview. Run `toolkit mc build run` afterwards to apply it on the canvas.
 */
export async function importBuild(
  dir: string,
  file: string,
  options: ImportOptions,
): Promise<{ schematic: string; at: BlockPos; size: Vec3; blocks: number; description: string; render: string; lint: LintReport }> {
  const workspace = new BuildWorkspace(dir);
  const manifest = await workspace.manifest();
  const { grid, description } = await loadImport(file, options);
  const registry = await loadRegistry();
  const bytes = writeSchematic(grid, registry.dataVersion);
  const digest = sha(bytes, 12);
  const schematic = path.join(BUILD_FILES.schematicsDir, `import-${digest}.schem`);
  await mkdir(workspace.file(BUILD_FILES.schematicsDir), { recursive: true });
  await Bun.write(workspace.file(schematic), bytes);
  const at = options.at ?? manifest.anchor;
  const log = await workspace.oplog();
  const op: Op = {
    kind: "paste",
    world: manifest.world,
    schematic,
    at,
    rotate: options.rotate,
    ignoreAir: true,
    source: `import:${digest}`,
  };
  await workspace.writeOplog({ version: 1, ops: [...log.ops, op] });
  const blocks = grid
    .histogram()
    .filter((entry) => !isAir(entry.state))
    .reduce((sum, entry) => sum + entry.count, 0);
  const render = await renderGrid(workspace, grid, `import-${digest}`, `${manifest.name} import`);
  return {
    schematic,
    at,
    size: grid.size,
    blocks,
    description,
    render,
    lint: lintGrid(grid, { registry, origin: at }),
  };
}

/** Resets the canvas to the site, replays every op, and records the result as expected. */
export async function runBuild(env: Env, dir: string, options: { target?: string }): Promise<{ target: string; ops: number }> {
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
  const snapshot = await env.client.snapshot(target, box, `expected:${manifest.name}`);
  await Bun.write(workspace.file(BUILD_FILES.expectedSchematic), await env.client.snapshotBytes(target, snapshot.id));
  await workspace.writeExpected(await env.client.regionRead(target, box));
  return { target, ops: ops.length };
}

export async function renderBuild(
  env: Env,
  dir: string,
  options: { target?: string; expected?: boolean; name?: string },
): Promise<{ render: string }> {
  const workspace = new BuildWorkspace(dir);
  const manifest = await workspace.manifest();
  const grid =
    options.expected === true
      ? await workspace.expected()
      : await readGrid(env.client, canvasOf(manifest, options.target), workspace.siteBox(manifest));
  const name = options.name ?? `render-${Date.now().toString(36)}`;
  return { render: await renderGrid(workspace, grid, name, manifest.name) };
}

export async function lintBuild(env: Env, dir: string, options: { target?: string; expected?: boolean }): Promise<LintReport> {
  const workspace = new BuildWorkspace(dir);
  const manifest = await workspace.manifest();
  const box = workspace.siteBox(manifest);
  const grid = options.expected === true ? await workspace.expected() : await readGrid(env.client, canvasOf(manifest, options.target), box);
  return lintGrid(grid, { registry: await loadRegistry(), origin: box.min });
}

export async function replayBuild(
  env: Env,
  dir: string,
  options: { target?: string; keep?: boolean },
): Promise<{ target: string; ops: number } & GridDiff> {
  const workspace = new BuildWorkspace(dir);
  const manifest = await workspace.manifest();
  const box = workspace.siteBox(manifest);
  const expected = await workspace.expected();
  const target = options.target ?? (await seededSandbox(env, workspace, manifest, 3600));
  try {
    const run = context(env, workspace, manifest, target);
    if (options.target !== undefined) {
      await resetToSite(run, box);
    }
    const { ops } = await workspace.oplog();
    await runOps(run, ops);
    const diff = diffGrids(expected, await readGrid(env.client, target, box), box.min);
    return { target, ops: ops.length, ...diff };
  } finally {
    if (options.target === undefined && options.keep !== true) {
      await env.client.destroySandbox(target);
    }
  }
}

async function planFor(env: Env, workspace: BuildWorkspace, manifest: BuildManifest, target: string) {
  const box = workspace.siteBox(manifest);
  const expected = await workspace.expected();
  const { ops } = await workspace.oplog();
  const current = await readGrid(env.client, target, box);
  const siteHash = manifest.site?.siteHash ?? "";
  const frozen = new Uint8Array(await Bun.file(workspace.file(BUILD_FILES.expectedSchematic)).arrayBuffer());
  const planHash = sha(JSON.stringify({ target, siteHash, ops, expected: gridHash(expected), frozen: sha(frozen) }));
  return { box, expected, ops, current, siteHash, planHash, frozen, drifted: gridHash(current) !== siteHash };
}

export type PromoteResult = {
  target: string;
  planHash: string;
  ops: number;
  changes: number;
  applied: JournalEntry | null;
  diff: GridDiff | null;
};

/**
 * Dry run (no --confirm): checks the target still matches the captured site
 * and prints the plan hash. With --confirm <planHash>: snapshots the box,
 * pastes the frozen canvas result (expected.schem), verifies, and journals.
 */
export async function promoteBuild(
  env: Env,
  dir: string,
  options: { target: string; confirm?: string },
): Promise<PromoteResult> {
  const workspace = new BuildWorkspace(dir);
  const manifest = await workspace.manifest();
  const plan = await planFor(env, workspace, manifest, options.target);
  if (plan.drifted) {
    throw new Error(
      `${options.target} no longer matches the captured site (siteHash drift). Re-capture the site, rebuild, and replay before promoting.`,
    );
  }
  const changes = plan.expected.diff(plan.current, 0).count;
  const base = { target: options.target, planHash: plan.planHash, ops: plan.ops.length, changes };
  if (options.confirm === undefined) {
    return { ...base, applied: null, diff: null };
  }
  if (options.confirm !== plan.planHash) {
    throw new Error(`--confirm ${options.confirm} does not match the current plan ${plan.planHash}; re-run the dry run`);
  }
  const applyId = Journal.newId();
  const snapshot = await env.client.snapshot(options.target, plan.box, `undo:${applyId}`);
  const now = new Date().toISOString();
  const entry: JournalEntry = {
    version: 1,
    applyId,
    target: options.target,
    buildDir: workspace.dir,
    world: plan.box.world,
    min: plan.box.min,
    max: plan.box.max,
    planHash: plan.planHash,
    snapshotId: snapshot.id,
    siteHash: plan.siteHash,
    status: "applying",
    mismatches: null,
    createdAt: now,
    updatedAt: now,
  };
  await env.journal.write(entry);
  await env.client.paste(options.target, {
    session: BuildWorkspace.session(manifest),
    world: plan.box.world,
    schematic: Buffer.from(plan.frozen).toString("base64"),
    at: plan.box.min,
    rotate: 0,
    ignoreAir: false,
  });
  const diff = diffGrids(plan.expected, await readGrid(env.client, options.target, plan.box), plan.box.min);
  const done: JournalEntry = {
    ...entry,
    status: diff.mismatches === 0 ? "verified" : "failed",
    mismatches: diff.mismatches,
    updatedAt: new Date().toISOString(),
  };
  await env.journal.write(done);
  return { ...base, applied: done, diff };
}

export async function verifyApply(env: Env, applyId: string): Promise<{ entry: JournalEntry } & GridDiff> {
  const entry = await env.journal.find(applyId);
  const workspace = new BuildWorkspace(entry.buildDir);
  const box = { world: entry.world, min: entry.min, max: entry.max };
  const diff = diffGrids(await workspace.expected(), await readGrid(env.client, entry.target, box), box.min);
  const updated: JournalEntry = {
    ...entry,
    status: diff.mismatches === 0 ? "verified" : "failed",
    mismatches: diff.mismatches,
    updatedAt: new Date().toISOString(),
  };
  await env.journal.write(updated);
  return { entry: updated, ...diff };
}

export async function undoApply(env: Env, applyId: string): Promise<{ entry: JournalEntry; restoredToSite: boolean }> {
  const entry = await env.journal.find(applyId);
  if (entry.status === "undone") {
    throw new Error(`${applyId} is already undone`);
  }
  const blockers = await env.journal.blockers(entry);
  if (blockers.length > 0) {
    throw new Error(
      `Undo is last-in-first-out: undo ${blockers.map((other) => other.applyId).join(", ")} first (they overlap ${applyId}).`,
    );
  }
  await env.client.restore(entry.target, entry.snapshotId);
  const box = { world: entry.world, min: entry.min, max: entry.max };
  const restored = gridHash(await readGrid(env.client, entry.target, box)) === entry.siteHash;
  const updated: JournalEntry = { ...entry, status: "undone", updatedAt: new Date().toISOString() };
  await env.journal.write(updated);
  return { entry: updated, restoredToSite: restored };
}

export async function buildStatus(
  env: Env,
  dir: string,
): Promise<{ manifest: BuildManifest; ops: { manual: number; program: number }; applies: JournalEntry[] }> {
  const workspace = new BuildWorkspace(dir);
  const manifest = await workspace.manifest();
  const { ops } = await workspace.oplog();
  const program = ops.filter((op) => op.source.startsWith("program:")).length;
  const entries = await env.journal.list();
  const applies = entries.filter((entry) => entry.buildDir === workspace.dir);
  return { manifest, ops: { manual: ops.length - program, program }, applies };
}
