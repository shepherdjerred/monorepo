import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import { writeSchematic } from "@shepherdjerred/mc-build/core/schem.ts";
import { gridHash } from "@shepherdjerred/mc-build/core/site.ts";
import { lintGrid } from "@shepherdjerred/mc-build/lint/lint.ts";
import { loadRegistry } from "@shepherdjerred/mc-build/registry/registry.ts";
import type { BlockPos } from "#protocol/bridge.ts";
import { BUILD_FILES, type RenderSidecar } from "#protocol/build.ts";
import { iterationOf } from "#build/build-log.ts";
import { writeSidecar, type RenderProvenance } from "#build/sidecar.ts";
import type { BuildWorkspace } from "#build/workspace.ts";
import {
  writeRenderContext,
  type RegionContext,
} from "#build/render-context.ts";

/**
 * Keeps what a render was of: the grid itself as `renders/<name>.schem` (so
 * a later render can compare against it and a critique can re-render it),
 * the program that produced it as `renders/<name>.build.ts` (the snapshot
 * `compile` kept, chosen for the source by `programBehind`, so a critique
 * reviews the code behind the picture and never a later compile), and
 * the sidecar `renders/<name>.json` with the files, lint summary and grid
 * hash, paths relative to the build directory.
 */
export async function recordRender(
  workspace: BuildWorkspace,
  grid: BlockGrid,
  input: {
    name: string;
    files: Record<string, string>;
    source: string;
    provenance: RenderProvenance;
    box?: { min: BlockPos; max: BlockPos };
    regionContext?: RegionContext;
  },
): Promise<void> {
  const registry = await loadRegistry();
  const renderContext = await writeRenderContext(
    workspace,
    input.name,
    input.regionContext,
    registry.dataVersion,
  );
  await mkdir(workspace.file(BUILD_FILES.rendersDir), { recursive: true });
  await Bun.write(
    workspace.file(path.join(BUILD_FILES.rendersDir, `${input.name}.schem`)),
    writeSchematic(grid, registry.dataVersion),
  );
  const lint = lintGrid(grid, { registry });
  const { journal, programText } = input.provenance;
  const programCopy = path.join(
    BUILD_FILES.rendersDir,
    `${input.name}.build.ts`,
  );
  if (programText !== null) {
    await Bun.write(workspace.file(programCopy), programText);
  }
  const sidecar: RenderSidecar = {
    name: input.name,
    at: new Date().toISOString(),
    iteration: iterationOf(journal) + 1,
    source: input.source,
    files: relativeFiles(workspace, input.files),
    gridHash: gridHash(grid),
    size: grid.size,
    ...(input.box === undefined ? {} : { box: input.box }),
    ...(renderContext === undefined ? {} : { context: renderContext }),
    blocks: lint.stats.blocks,
    program: programText === null ? null : programCopy,
    lint: {
      errors: lint.errors,
      warnings: lint.warnings,
      codes: [
        ...new Set(lint.findings.map((finding) => finding.code)),
      ].toSorted(),
    },
  };
  await writeSidecar(workspace, sidecar);
}

/** The same file map with paths relative to the build directory. */
export function relativeFiles(
  workspace: BuildWorkspace,
  files: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(files).map(([key, file]) => [
      key,
      path.relative(workspace.dir, file),
    ]),
  );
}
