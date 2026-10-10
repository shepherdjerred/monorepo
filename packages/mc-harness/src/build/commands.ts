import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
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
import { producingProgram } from "./sidecar.ts";
import {
  programSnapshot,
  recordProgramEvidence,
} from "./storage/program-evidence.ts";
import { gridFor, type RenderSource } from "./sources.ts";
import { DEFAULT_SANDBOX_TTL_SECONDS } from "#protocol/paths.ts";
import { resetToSite, runOps } from "./ops.ts";
import { boxSize, cropGrid, emptyGrid, placeGrid, tileBox } from "./tiles.ts";
import { BuildWorkspace } from "./workspace.ts";
import { validateFrozenExpected, type FrozenPart } from "./frozen-expected.ts";
import { publishFiles } from "./file-transaction.ts";
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
import { renderBuildCommand } from "./render/command.ts";
import { stageJournal, stagedFiles } from "./storage/evidence-publication.ts";
import { writeRunIdentity } from "./storage/run-identity.ts";
import { withPublicationLock } from "#protocol/publication-lock.ts";
import { writeCaptureIdentity } from "./storage/capture-identity.ts";

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
  const box: Box = {
    world: options.box.world,
    min: {
      x: Math.min(options.box.min.x, options.box.max.x),
      y: Math.min(options.box.min.y, options.box.max.y),
      z: Math.min(options.box.min.z, options.box.max.z),
    },
    max: {
      x: Math.max(options.box.min.x, options.box.max.x),
      y: Math.max(options.box.min.y, options.box.max.y),
      z: Math.max(options.box.min.z, options.box.max.z),
    },
  };
  let result:
    | { siteHash: string; size: Vec3; render: string; surface: string[] }
    | undefined;
  await publishFiles(workspace, {
    prefix: ".capture-",
    stage: async (staged) => {
      const manifest = await workspace.manifestForCapture();
      const parts = await snapshotFrozen(
        env,
        options.target,
        box,
        `site:${manifest.name}`,
      );
      const region = await env.client.regionRead(options.target, box);
      const grid = gridFromRegionRead(region);
      const snapshotted = emptyGrid(grid.size);
      let dataVersion = 0;
      for (const part of parts) {
        const schematic = await readSchematic(part.bytes);
        dataVersion = schematic.dataVersion;
        placeGrid(snapshotted, schematic.grid, {
          x: part.at.x - box.min.x,
          y: part.at.y - box.min.y,
          z: part.at.z - box.min.z,
        });
      }
      if (snapshotted.diff(grid).count > 0) {
        throw new Error(
          "The site snapshot and region read disagree; the area changed during capture. Retry.",
        );
      }
      const info = analyzeSite(grid, options.box.world, region.min);
      const id = randomUUID();
      // A new capture starts a new competition; retain old candidates for inspection.
      const {
        best: _best,
        knockout: _knockout,
        canvas: _canvas,
        ...capturedManifest
      } = manifest;
      const captured = {
        ...capturedManifest,
        world: options.box.world,
        site: { id, min: region.min, max: region.max, siteHash: info.siteHash },
      };
      const pending = new BuildWorkspace(staged);
      await pending.writeFrozen(
        "site",
        parts,
        parts.length > 1 ? writeSchematic(grid, dataVersion) : undefined,
      );
      await Bun.write(
        pending.file(BUILD_FILES.siteInfo),
        `${JSON.stringify(info)}\n`,
      );
      await pending.writeManifest(captured);
      await writeCaptureIdentity(pending, {
        id,
        siteHash: info.siteHash,
        box,
      });
      await renderGrid(pending, grid, "site", `${manifest.name} site`);
      await stageJournal(workspace, pending, {
        kind: "capture",
        id,
        siteHash: info.siteHash,
        box,
      });
      result = {
        siteHash: info.siteHash,
        size: region.size,
        render: workspace.file("renders/site.png"),
        surface: info.surface
          .slice(0, 5)
          .map((entry) => `${entry.state} ×${entry.count.toString()}`),
      };
      // Install the boundary first: an interrupted capture must invalidate old expected results.
      return [
        BUILD_FILES.journal,
        BUILD_FILES.siteDir,
        BUILD_FILES.manifest,
        "renders/site.png",
      ];
    },
  });
  if (result === undefined)
    throw new Error("capture publication did not produce a result");
  return result;
}

/** Fresh void sandbox with the captured site pasted at its original coordinates. */
export async function createCanvas(
  env: Env,
  dir: string,
  options: { ttlSeconds?: number },
): Promise<{ canvas: string }> {
  const workspace = new BuildWorkspace(dir);
  return withPublicationLock(workspace.dir, async () => {
    const manifest = await workspace.manifest();
    const canvas = await seededSandbox(
      env,
      workspace,
      manifest,
      options.ttlSeconds ?? DEFAULT_SANDBOX_TTL_SECONDS,
    );
    await workspace.writeManifest({ ...manifest, canvas });
    return { canvas };
  });
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

type CompileResult = {
  schematic: string;
  at: BlockPos;
  size: Vec3;
  blocks: number;
  clears: number;
  ops: number;
  logs: string[];
  lint: LintReport;
};

export async function compileBuild(dir: string): Promise<CompileResult> {
  const workspace = new BuildWorkspace(dir);
  let result: CompileResult | undefined;
  await publishFiles(workspace, {
    prefix: ".compile-",
    stage: async (staged) => {
      const pending = new BuildWorkspace(staged);
      const manifest = await workspace.manifest();
      const hasSite = await Bun.file(
        workspace.file(BUILD_FILES.siteInfo),
      ).exists();
      const programBytes = await Bun.file(
        workspace.file(BUILD_FILES.program),
      ).bytes();
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
      const afterCompile = await Bun.file(
        workspace.file(BUILD_FILES.program),
      ).bytes();
      if (sha(programBytes, 64) !== sha(afterCompile, 64))
        throw new Error(
          "program changed during compilation; compile the build again",
        );
      const digest = sha(`${sha(programBytes)}\n${sha(bytes)}`, 12);
      const schematic = path.join(
        BUILD_FILES.schematicsDir,
        `program-${digest}.schem`,
      );
      await mkdir(pending.file(BUILD_FILES.schematicsDir), { recursive: true });
      await Bun.write(pending.file(schematic), bytes);
      // The program as compiled, kept with its output so a render can say
      // which text produced the blocks even after build.ts is edited again.
      await Bun.write(pending.file(programSnapshot(digest)), programBytes);
      const source = `program:${digest}`;
      const at = plus(manifest.anchor, compiled.min);
      const pastes = await programPastes(pending, compiled.grid, {
        digest,
        whole: schematic,
        at,
        world: manifest.world,
        dataVersion: registry.dataVersion,
      });
      await recordProgramEvidence(
        pending,
        digest,
        pastes.map((paste) => paste.schematic),
      );
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
      await pending.writeOplog({
        version: 1,
        ops: [
          ...kept.slice(0, insertAt),
          ...programOps,
          ...kept.slice(insertAt),
        ],
      });
      result = {
        schematic,
        at,
        size: compiled.grid.size,
        blocks: compiled.blocks,
        clears: compiled.clears.length,
        ops: programOps.length,
        logs: compiled.logs,
        lint: lintGrid(compiled.grid, { registry, origin: at }),
      };
      await stageJournal(workspace, pending, {
        kind: "compile",
        program: BUILD_FILES.program,
        ops: result.ops,
        lintErrors: result.lint.errors,
        lintWarnings: result.lint.warnings,
      });
      const artifacts = await stagedFiles(staged);
      // Keep the preceding op log active until its replacements and compile entry are installed.
      return [
        ...artifacts.filter(
          (file) => file !== BUILD_FILES.oplog && file !== BUILD_FILES.journal,
        ),
        BUILD_FILES.journal,
        BUILD_FILES.oplog,
      ];
    },
  });
  if (result === undefined)
    throw new Error("compile publication did not produce a result");
  return result;
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
  let result: { target: string; ops: number } | undefined;
  await publishFiles(workspace, {
    prefix: ".run-",
    stage: async (staged) => {
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
      const id = randomUUID();
      const pending = new BuildWorkspace(staged);
      await pending.writeFrozen("expected", frozen);
      await pending.writeExpected(region);
      await writeRunIdentity(pending, id);
      await stageJournal(workspace, pending, {
        kind: "run",
        id,
        target,
        ops: ops.length,
        program,
      });
      result = { target, ops: ops.length };
      return [
        BUILD_FILES.expectedRun,
        BUILD_FILES.expected,
        BUILD_FILES.expectedSchematic,
        BUILD_FILES.expectedParts,
        BUILD_FILES.journal,
      ];
    },
  });
  if (result === undefined)
    throw new Error("run publication did not produce a result");
  return result;
}

export function renderBuild(
  env: Env,
  dir: string,
  options: Parameters<typeof renderBuildCommand>[2],
): ReturnType<typeof renderBuildCommand> {
  return renderBuildCommand(env, dir, options);
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
