import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  type BlockGrid,
  type Vec3,
} from "@shepherdjerred/mc-build/core/grid.ts";
import { isAir } from "@shepherdjerred/mc-build/core/block-state.ts";
import { readLitematic } from "@shepherdjerred/mc-build/core/litematic.ts";
import {
  readSchematic,
  writeSchematic,
} from "@shepherdjerred/mc-build/core/schem.ts";
import { importMesh } from "@shepherdjerred/mc-build/import/mesh.ts";
import {
  loadPalette,
  type PaletteName,
} from "@shepherdjerred/mc-build/import/palette.ts";
import {
  lintGrid,
  type LintReport,
} from "@shepherdjerred/mc-build/lint/lint.ts";
import { loadRegistry } from "@shepherdjerred/mc-build/registry/registry.ts";
import { ensureAssets } from "@shepherdjerred/mc-build/render/assets.ts";
import type { BlockPos, Rotation } from "#protocol/bridge.ts";
import { BUILD_FILES, type Op } from "#protocol/build.ts";
import { BuildWorkspace } from "./workspace.ts";
import { renderGrid, sha } from "./helpers.ts";

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
async function loadImport(
  file: string,
  options: ImportOptions,
): Promise<{ grid: BlockGrid; description: string }> {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".litematic") {
    const info = await readLitematic(
      new Uint8Array(await Bun.file(file).arrayBuffer()),
    );
    const regions = info.regions.length.toString();
    return {
      grid: info.grid,
      description: `litematic "${info.name}" by ${info.author || "unknown"} (${regions} region(s))`,
    };
  }
  if (extension === ".schem") {
    const info = await readSchematic(
      new Uint8Array(await Bun.file(file).arrayBuffer()),
    );
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
): Promise<{
  schematic: string;
  at: BlockPos;
  size: Vec3;
  blocks: number;
  description: string;
  render: string;
  lint: LintReport;
}> {
  const workspace = new BuildWorkspace(dir);
  const manifest = await workspace.manifest();
  const { grid, description } = await loadImport(file, options);
  const registry = await loadRegistry();
  const bytes = writeSchematic(grid, registry.dataVersion);
  const digest = sha(bytes, 12);
  const schematic = path.join(
    BUILD_FILES.schematicsDir,
    `import-${digest}.schem`,
  );
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
  const render = await renderGrid(
    workspace,
    grid,
    `import-${digest}`,
    `${manifest.name} import`,
  );
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
