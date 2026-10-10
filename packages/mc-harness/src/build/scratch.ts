/**
 * `build scratch`: a throwaway pad beside the site for trying a wall, a roof
 * or a tree before it goes in the real program. It is an ordinary build
 * directory (`<dir>/scratch/`) in the same world whose site is flat grass
 * over dirt up to the anchor and air above, so the offline loop
 * (`compile → render --source compiled → lint`) works on it at once, and
 * `run` works on the canvas when one exists.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { analyzeSite, gridHash } from "@shepherdjerred/mc-build/core/site.ts";
import { writeSchematic } from "@shepherdjerred/mc-build/core/schem.ts";
import { loadRegistry } from "@shepherdjerred/mc-build/registry/registry.ts";
import type { BlockPos } from "#protocol/bridge.ts";
import { BUILD_FILES, type BuildManifest } from "#protocol/build.ts";
import { initBuild } from "./commands.ts";
import { publishFiles } from "./file-transaction.ts";
import { stageJournal } from "./storage/evidence-publication.ts";
import { emptyGrid } from "./tiles.ts";
import { BuildWorkspace } from "./workspace.ts";

const GRASS = "minecraft:grass_block[snowy=false]";
const DIRT = "minecraft:dirt";

export const SCRATCH_GAP = 8;
export const SCRATCH_SIZE = 32;

/** How far the pad extends below its anchor, so foundations and cellars fit. */
export function scratchDepth(size: number): number {
  return Math.min(8, Math.floor(size / 4));
}

/**
 * The pad's anchor: just past the site's east edge, or, when no site is
 * captured, one pad width past the anchor so a pad of `size` cannot overlap
 * what is built there.
 */
export function scratchAnchor(manifest: BuildManifest, size: number): BlockPos {
  const x =
    manifest.site === undefined
      ? manifest.anchor.x + size + SCRATCH_GAP
      : manifest.site.max.x + 1 + SCRATCH_GAP;
  return { x, y: manifest.anchor.y, z: manifest.anchor.z };
}

export async function createScratch(
  dir: string,
  options: { size?: number } = {},
): Promise<{ dir: string; anchor: BlockPos; size: number; created: string[] }> {
  const parent = new BuildWorkspace(dir);
  const size = options.size ?? SCRATCH_SIZE;
  if (!Number.isInteger(size) || size < 4 || size > 256) {
    throw new Error(
      `--size must be an integer from 4 to 256 (got ${String(size)})`,
    );
  }
  let result:
    | { dir: string; anchor: BlockPos; size: number; created: string[] }
    | undefined;
  await publishFiles(parent, {
    prefix: ".build-record-scratch-",
    exclusive: [BUILD_FILES.scratchDir],
    stage: async (staged) => {
      const manifest = await parent.manifest();
      const anchor = scratchAnchor(manifest, size);
      const scratchDir = path.join(staged, BUILD_FILES.scratchDir);
      const name = `${manifest.name.slice(0, 28)}-pad`;
      const { created } = await initBuild(scratchDir, {
        name,
        world: manifest.world,
        anchor,
        seed: manifest.seed,
      });
      const pad = new BuildWorkspace(scratchDir);
      const grid = emptyGrid({ x: size, y: size, z: size });
      const depth = scratchDepth(size);
      for (let y = 0; y < depth; y += 1) {
        for (let z = 0; z < size; z += 1) {
          for (let x = 0; x < size; x += 1) {
            grid.set(x, y, z, y === depth - 1 ? GRASS : DIRT);
          }
        }
      }
      const registry = await loadRegistry();
      await mkdir(pad.file(BUILD_FILES.siteDir), { recursive: true });
      const bytes = writeSchematic(grid, registry.dataVersion);
      const min = { x: anchor.x, y: anchor.y - depth, z: anchor.z };
      await pad.writeFrozen("site", [{ at: min, bytes }]);
      await Bun.write(
        pad.file(BUILD_FILES.siteInfo),
        `${JSON.stringify(analyzeSite(grid, manifest.world, min))}\n`,
      );
      const max = {
        x: min.x + size - 1,
        y: min.y + size - 1,
        z: min.z + size - 1,
      };
      const padManifest = await pad.manifest();
      await pad.writeManifest({
        ...padManifest,
        site: { min, max, siteHash: gridHash(grid) },
      });
      await stageJournal(parent, new BuildWorkspace(staged), {
        kind: "note",
        text: `scratch pad ${BUILD_FILES.scratchDir}/ at ${anchor.x.toString()},${anchor.y.toString()},${anchor.z.toString()} (${size.toString()}³ void)`,
      });
      result = {
        dir: parent.file(BUILD_FILES.scratchDir),
        anchor,
        size,
        created: [...created, BUILD_FILES.siteSchematic, BUILD_FILES.siteInfo],
      };
      return [BUILD_FILES.scratchDir, BUILD_FILES.journal];
    },
  });
  if (result === undefined) throw new Error("scratch build was not staged");
  return result;
}
