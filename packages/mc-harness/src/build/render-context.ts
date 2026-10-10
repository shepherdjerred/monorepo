import path from "node:path";
import type { BlockGrid, Vec3 } from "@shepherdjerred/mc-build/core/grid.ts";
import {
  readSchematic,
  writeSchematic,
} from "@shepherdjerred/mc-build/core/schem.ts";
import { gridHash } from "@shepherdjerred/mc-build/core/site.ts";
import { cropGrid } from "@shepherdjerred/mc-build/render/cut.ts";
import { BUILD_FILES, type RenderSidecar } from "#protocol/build.ts";
import { buildArtifactPath, checkName } from "./sidecar.ts";
import type { BuildWorkspace } from "./workspace.ts";

export type RegionContext = { grid: BlockGrid; origin: Vec3 };

function contextFile(name: string): string {
  return path.join(
    BUILD_FILES.rendersDir,
    "context",
    `${checkName("render", name)}.schem`,
  );
}

/** Save surroundings independently of the selected-region schematic. */
export async function writeRenderContext(
  workspace: BuildWorkspace,
  name: string,
  context: RegionContext | undefined,
  dataVersion: number,
): Promise<RenderSidecar["context"]> {
  if (context === undefined) return undefined;
  await Bun.write(
    workspace.file(contextFile(name)),
    writeSchematic(context.grid, dataVersion),
  );
  return { gridHash: gridHash(context.grid), origin: context.origin };
}

/** Restore the earlier panel's own surroundings, never the current build's. */
export async function readRenderContext(
  workspace: BuildWorkspace,
  sidecar: RenderSidecar,
  saved: BlockGrid,
): Promise<RegionContext> {
  const axes = ["x", "y", "z"] as const;
  if (sidecar.context === undefined) {
    const site = workspace.siteBox(await workspace.manifest());
    if (
      sidecar.box === undefined ||
      axes.some(
        (axis) =>
          sidecar.box?.min[axis] !== site.min[axis] ||
          sidecar.box.max[axis] !== site.max[axis],
      )
    ) {
      throw new Error(
        `render "${sidecar.name}" has no whole-site context; render it again before comparing`,
      );
    }
    return { grid: saved, origin: { x: 0, y: 0, z: 0 } };
  }
  const { grid } = await readSchematic(
    await Bun.file(
      await buildArtifactPath(workspace, contextFile(sidecar.name)),
    ).bytes(),
  );
  const { origin } = sidecar.context;
  if (
    gridHash(grid) !== sidecar.context.gridHash ||
    axes.some(
      (axis) =>
        origin[axis] < 0 || origin[axis] + saved.size[axis] > grid.size[axis],
    )
  ) {
    throw new Error(`render "${sidecar.name}" has invalid whole-site context`);
  }
  const selected = cropGrid(grid, {
    min: origin,
    max: {
      x: origin.x + saved.size.x - 1,
      y: origin.y + saved.size.y - 1,
      z: origin.z + saved.size.z - 1,
    },
  });
  if (gridHash(selected) !== sidecar.gridHash)
    throw new Error(
      `render "${sidecar.name}" context does not match its selected region`,
    );
  return { grid, origin };
}
