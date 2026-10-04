import { mkdir } from "node:fs/promises";
import path from "node:path";
import { BlockGrid, gridFromRegionRead } from "@shepherdjerred/mc-build/core/grid.ts";
import { RegionReadSchema } from "@shepherdjerred/mc-build/core/region-read.ts";
import { readSchematic } from "@shepherdjerred/mc-build/core/schem.ts";
import { SiteInfoSchema, type SiteInfo } from "@shepherdjerred/mc-build/core/site.ts";
import type { Box, RegionReadResponse } from "#protocol/bridge.ts";
import {
  BUILD_FILES,
  BuildManifestSchema,
  readOpLog,
  writeOpLog,
  type BuildManifest,
  type OpLog,
} from "#protocol/build.ts";

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
      throw new Error(`${this.dir} is not a build directory (no ${BUILD_FILES.manifest}); run toolkit mc build init first`);
    }
    return BuildManifestSchema.parse(await file.json());
  }

  async writeManifest(manifest: BuildManifest): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await Bun.write(this.file(BUILD_FILES.manifest), `${JSON.stringify(BuildManifestSchema.parse(manifest), null, 2)}\n`);
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
      throw new Error(`No site captured for ${manifest.name}; run toolkit mc build capture first`);
    }
    return { world: manifest.world, min: manifest.site.min, max: manifest.site.max };
  }

  async siteInfo(): Promise<SiteInfo> {
    return SiteInfoSchema.parse(await Bun.file(this.file(BUILD_FILES.siteInfo)).json());
  }

  async siteSchematicBase64(): Promise<string> {
    const bytes = await Bun.file(this.file(BUILD_FILES.siteSchematic)).arrayBuffer();
    return Buffer.from(bytes).toString("base64");
  }

  async siteGrid(): Promise<BlockGrid> {
    const bytes = new Uint8Array(await Bun.file(this.file(BUILD_FILES.siteSchematic)).arrayBuffer());
    const schematic = await readSchematic(bytes);
    return schematic.grid;
  }

  async writeExpected(region: RegionReadResponse): Promise<void> {
    await Bun.write(this.file(BUILD_FILES.expected), JSON.stringify(region));
  }

  async expected(): Promise<BlockGrid> {
    const file = Bun.file(this.file(BUILD_FILES.expected));
    if (!(await file.exists())) {
      throw new Error(`No ${BUILD_FILES.expected} in ${this.dir}; run toolkit mc build run on the canvas first`);
    }
    return gridFromRegionRead(RegionReadSchema.parse(await file.json()));
  }

  /** WorldEdit session name for this build's edits (history is per session). */
  static session(manifest: BuildManifest): string {
    return `build-${manifest.name}`.slice(0, 32);
  }
}
