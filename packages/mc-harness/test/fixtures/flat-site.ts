/** A build directory whose captured site is a 10×10×10 box with a grass floor at 100,64,100. */
import { BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import { writeSchematic } from "@shepherdjerred/mc-build/core/schem.ts";
import { loadRegistry } from "@shepherdjerred/mc-build/registry/registry.ts";
import { gridHash } from "@shepherdjerred/mc-build/core/site.ts";
import { BuildWorkspace } from "#build/workspace.ts";
import { BUILD_FILES, type Op } from "#protocol/build.ts";

/** One reproducible edit of the captured floor for distinct candidate grids. */
export function clearFloorOp(index: number): Op {
  return {
    kind: "we",
    command: "//set air",
    world: "world",
    pos1: { x: 100 + index, y: 64, z: 100 },
    pos2: { x: 100 + index, y: 64, z: 100 },
    source: "manual",
  };
}

export async function flatSiteBuild(
  dir: string,
  name: string,
): Promise<BuildWorkspace> {
  const workspace = new BuildWorkspace(dir);
  const site = new BlockGrid({ x: 10, y: 10, z: 10 });
  for (let x = 0; x < 10; x += 1) {
    for (let z = 0; z < 10; z += 1) {
      site.set(x, 0, z, "minecraft:grass_block[snowy=false]");
    }
  }
  await workspace.writeManifest({
    version: 1,
    name,
    world: "world",
    anchor: { x: 100, y: 64, z: 100 },
    seed: 1,
    site: {
      min: { x: 100, y: 64, z: 100 },
      max: { x: 109, y: 73, z: 109 },
      siteHash: gridHash(site),
    },
  });
  const registry = await loadRegistry();
  await Bun.write(
    workspace.file(BUILD_FILES.siteSchematic),
    writeSchematic(site, registry.dataVersion),
  );
  return workspace;
}
