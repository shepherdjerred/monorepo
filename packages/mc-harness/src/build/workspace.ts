import { mkdir, rm } from "node:fs/promises";
import { z } from "zod";
import path from "node:path";
import type { BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import { gridFromRegionRead } from "@shepherdjerred/mc-build/core/grid.ts";
import { RegionReadSchema } from "@shepherdjerred/mc-build/core/region-read.ts";
import { readSchematic } from "@shepherdjerred/mc-build/core/schem.ts";
import {
  SiteInfoSchema,
  type SiteInfo,
} from "@shepherdjerred/mc-build/core/site.ts";
import {
  BlockPosSchema,
  type BlockPos,
  type Box,
  type RegionReadResponse,
} from "#protocol/bridge.ts";
import {
  BUILD_FILES,
  BuildManifestSchema,
  readOpLog,
  writeOpLog,
  type BuildManifest,
  type OpLog,
} from "#protocol/build.ts";
import { currentRun, lastOf, readLog } from "./build-log.ts";

/** A frozen snapshot of a box: one schematic, or tiles each pasted at `at`. */
export type FrozenPart = { at: BlockPos; bytes: Uint8Array };
export type FrozenKind = "site" | "expected";

const PartsIndexSchema = z.array(
  z.strictObject({
    file: z.string().regex(/^\d+\.schem$/u),
    at: BlockPosSchema,
  }),
);

const FROZEN_FILES: Record<FrozenKind, { single: string; parts: string }> = {
  site: { single: BUILD_FILES.siteSchematic, parts: BUILD_FILES.siteParts },
  expected: {
    single: BUILD_FILES.expectedSchematic,
    parts: BUILD_FILES.expectedParts,
  },
};

/** One build directory: manifest, op log, captured site, expected result. */
export class BuildWorkspace {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = path.resolve(dir);
  }

  file(relative: string): string {
    return path.join(this.dir, relative);
  }

  async manifest(): Promise<BuildManifest> {
    const file = Bun.file(this.file(BUILD_FILES.manifest));
    if (!(await file.exists())) {
      throw new Error(
        `${this.dir} is not a build directory (no ${BUILD_FILES.manifest}); run toolkit mc build init first`,
      );
    }
    return BuildManifestSchema.parse(await file.json());
  }

  async writeManifest(manifest: BuildManifest): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await Bun.write(
      this.file(BUILD_FILES.manifest),
      `${JSON.stringify(BuildManifestSchema.parse(manifest), null, 2)}\n`,
    );
  }

  oplog(): Promise<OpLog> {
    return readOpLog(this.dir);
  }

  writeOplog(log: OpLog): Promise<void> {
    return writeOpLog(this.dir, log);
  }

  /** The captured site box (required for canvas, run, replay and promote). */
  siteBox(manifest: BuildManifest): Box {
    if (manifest.site === undefined) {
      throw new Error(
        `No site captured for ${manifest.name}; run toolkit mc build capture first`,
      );
    }
    return {
      world: manifest.world,
      min: manifest.site.min,
      max: manifest.site.max,
    };
  }

  async siteInfo(): Promise<SiteInfo> {
    return SiteInfoSchema.parse(
      await Bun.file(this.file(BUILD_FILES.siteInfo)).json(),
    );
  }

  /**
   * Stores a frozen box: a single part as the plain schematic file, several
   * (map-scale tiles) as `<parts>/<n>.schem` plus an index. A site always
   * keeps `site.schem` too (merged, for compile and analysis).
   */
  async writeFrozen(
    kind: FrozenKind,
    parts: readonly FrozenPart[],
    merged?: Uint8Array,
  ): Promise<void> {
    const files = FROZEN_FILES[kind];
    await rm(this.file(files.parts), { recursive: true, force: true });
    await mkdir(path.dirname(this.file(files.single)), { recursive: true });
    const [only] = parts;
    if (only !== undefined && parts.length === 1) {
      await Bun.write(this.file(files.single), only.bytes);
      return;
    }
    await mkdir(this.file(files.parts), { recursive: true });
    const index = await Promise.all(
      parts.map(async (part, n) => {
        const file = `${n.toString()}.schem`;
        await Bun.write(this.file(path.join(files.parts, file)), part.bytes);
        return { file, at: part.at };
      }),
    );
    await Bun.write(
      this.file(path.join(files.parts, "parts.json")),
      `${JSON.stringify(index)}\n`,
    );
    if (merged === undefined) {
      await rm(this.file(files.single), { force: true });
    } else {
      await Bun.write(this.file(files.single), merged);
    }
  }

  /** The frozen box as pasteable parts (tiles when it was snapshotted in tiles). */
  async frozenParts(kind: FrozenKind, box: Box): Promise<FrozenPart[]> {
    if (kind === "expected") await this.assertExpectedCurrent();
    const files = FROZEN_FILES[kind];
    const indexFile = Bun.file(this.file(path.join(files.parts, "parts.json")));
    if (await indexFile.exists()) {
      const index = PartsIndexSchema.parse(await indexFile.json());
      return Promise.all(
        index.map(async (entry) => ({
          at: entry.at,
          bytes: new Uint8Array(
            await Bun.file(
              this.file(path.join(files.parts, entry.file)),
            ).arrayBuffer(),
          ),
        })),
      );
    }
    const single = Bun.file(this.file(files.single));
    if (!(await single.exists())) {
      throw new Error(
        `No ${files.single} in ${this.dir}; ${kind === "site" ? "run toolkit mc build capture first" : "run toolkit mc build run on the canvas first"}`,
      );
    }
    return [{ at: box.min, bytes: new Uint8Array(await single.arrayBuffer()) }];
  }

  async siteGrid(): Promise<BlockGrid> {
    const bytes = new Uint8Array(
      await Bun.file(this.file(BUILD_FILES.siteSchematic)).arrayBuffer(),
    );
    const schematic = await readSchematic(bytes);
    return schematic.grid;
  }

  async writeExpected(region: RegionReadResponse): Promise<void> {
    await Bun.write(this.file(BUILD_FILES.expected), JSON.stringify(region));
  }

  async expected(): Promise<BlockGrid> {
    await this.assertExpectedCurrent();
    const file = Bun.file(this.file(BUILD_FILES.expected));
    if (!(await file.exists())) {
      throw new Error(
        `No ${BUILD_FILES.expected} in ${this.dir}; run toolkit mc build run on the canvas first`,
      );
    }
    return gridFromRegionRead(RegionReadSchema.parse(await file.json()));
  }

  private async assertExpectedCurrent(): Promise<void> {
    const journal = await readLog(this.dir);
    if (lastOf(journal, "capture") !== null && currentRun(journal) === null) {
      throw new Error(
        "No expected result for the current capture; run toolkit mc build run first",
      );
    }
  }

  /** WorldEdit session name for this build's edits (history is per session). */
  static session(manifest: BuildManifest): string {
    return `build-${manifest.name}`.slice(0, 32);
  }
}
