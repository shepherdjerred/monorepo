import path from "node:path";
import { mkdir, lstat, readdir, readFile } from "node:fs/promises";
import { z } from "zod";
import { cropRegion } from "./region.ts";
import { retainBlob, cachedBlob, type BlobStore } from "./store.ts";
import { PatchSchema, type TerrainPatch } from "./define.ts";
import { includesChunk, columnKey, verifyCoverage } from "./coverage.ts";

const relativeFile = z.string().regex(/^(?:level\.dat|dimensions\/minecraft\/[a-z][a-z0-9_]*\/(?:region|entities|poi)\/r\.-?\d+\.-?\d+\.mca)$/u);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const FixtureSchema = z.strictObject({
  schema: z.literal(1), source: z.string().min(1), capturedAt: z.iso.datetime(),
  patches: z.array(PatchSchema).min(1),
  files: z.array(z.strictObject({path: relativeFile, sha256: hash})).min(1),
}).superRefine((fixture, context) => {
  if (new Set(fixture.files.map(f => f.path)).size !== fixture.files.length || !fixture.files.some(f => f.path === "level.dat"))
    context.addIssue({code: "custom", message: "Fixture files are duplicate or lack level.dat"});
});
export type FixtureSource = {
  id: string;
  list: (world: string, layer: string) => Promise<string[]>;
  read: (file: string) => Promise<Uint8Array>;
};
export function worldFolder(world: string): string { return world === "world" ? "overworld" : world; }

export function localFixtureSource(directory: string): FixtureSource {
  const root = path.resolve(directory);
  return {id: root,
    list: async (world, layer) => {
      const folder = path.join(root, "dimensions/minecraft", worldFolder(world), layer);
      try {
        const metadata = await lstat(folder);
        if (metadata.isSymbolicLink()) throw new Error("Linked fixture directory");
        return await readdir(folder);
      } catch (error) {
        if (layer !== "region" && error instanceof Error && "code" in error && error.code === "ENOENT") return [];
        throw error;
      }
    },
    read: async file => {
      relativeFile.parse(file);
      const absolute = path.join(root, file);
      const metadata = await lstat(absolute);
      if (!metadata.isFile()) throw new Error("Fixture source is not a regular file");
      return new Uint8Array(await readFile(absolute));
    },
  };
}

function rememberTerrain(cropped: Buffer, location: {world: string; rx: number; rz: number}, terrain: Set<string>) {
  const {world, rx, rz} = location;
  for (let i = 0; i < 1024; i++) if (cropped.readUInt32BE(i * 4) !== 0)
    terrain.add(columnKey(world, rx * 32 + i % 32, rz * 32 + Math.floor(i / 32)));
}
async function retainLayer(source: FixtureSource, patches: TerrainPatch[], store: BlobStore, context: {world: string; layer: string; terrain: Set<string>}) {
  const {world, layer, terrain} = context;
  const files: {path: string; sha256: string}[] = [];
  const names = await source.list(world, layer);
  for (const name of names.toSorted()) {
        const match = /^r\.(-?\d+)\.(-?\d+)\.mca$/u.exec(name);
        if (match === null) throw new Error(`Unexpected region file ${name}`);
        const rx = Number(match[1]), rz = Number(match[2]);
        const relevant = Array.from({length: 1024}, (_, i) => [rx * 32 + i % 32, rz * 32 + Math.floor(i / 32)] as const)
          .some(([x, zz]) => includesChunk(patches, world, x, zz));
        if (!relevant) continue;
        const file = `dimensions/minecraft/${worldFolder(world)}/${layer}/${name}`;
        const cropped = cropRegion(await source.read(file), rx, rz, (x, zz) => includesChunk(patches, world, x, zz));
        if (layer === "region") rememberTerrain(cropped, {world, rx, rz}, terrain);
        if (cropped.length > 8192) files.push({path: file, sha256: await retainBlob(store, cropped)});
  }
  return files;
}
export async function retainFixture(source: FixtureSource, patches: TerrainPatch[], store: BlobStore): Promise<string> {
  patches.forEach(p => PatchSchema.parse(p));
  const files = [{path: "level.dat", sha256: await retainBlob(store, await source.read("level.dat"))}];
  const terrain = new Set<string>();
  for (const world of new Set(patches.map(p => p.world))) {
    for (const layer of ["region", "entities", "poi"])
      files.push(...await retainLayer(source, patches, store, {world, layer, terrain}));
  }
  verifyCoverage(patches, terrain);
  const manifest = FixtureSchema.parse({schema: 1, source: source.id, capturedAt: new Date().toISOString(), patches, files});
  return retainBlob(store, new TextEncoder().encode(JSON.stringify(manifest)));
}

export async function restoreFixture(store: BlobStore, cache: string, fixtureHash: string, destination: string): Promise<void> {
  const manifest = FixtureSchema.parse(await Bun.file(await cachedBlob(store, cache, fixtureHash)).json());
  await mkdir(destination, {recursive: false, mode: 0o700});
  await mkdir(path.join(destination, "data"));
  await mkdir(path.join(destination, "datapacks"));
  for (const file of manifest.files) {
    const target = path.join(destination, file.path);
    await mkdir(path.dirname(target), {recursive: true});
    await Bun.write(target, Bun.file(await cachedBlob(store, cache, file.sha256)));
  }
}
