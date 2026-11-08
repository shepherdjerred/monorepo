import path from "node:path";
import { mkdir, lstat, readdir, readFile, realpath } from "node:fs/promises";
import { z } from "zod";
import { gunzipSync } from "node:zlib";
import { validateNbt } from "./nbt.ts";
import { cropRegion } from "./region.ts";
import { retainBlob, cachedBlob, type BlobStore } from "./store.ts";
import { PatchSchema, type TerrainPatch } from "./define.ts";
import { includesChunk, columnKey, verifyCoverage } from "./coverage.ts";

const nativeSettings = String.raw`(?:world_gen_settings|game_rules|world_border|world_clocks|scheduled_events)\.dat`;
export const FixtureFileSchema = z
  .string()
  .refine(
    (file) =>
      !file
        .split("/")
        .some((part) => part === "" || part === "." || part === "..") &&
      new RegExp(
        String.raw`^(?:level\.dat|datapacks/[\w./-]+|(?:data/minecraft|dimensions/minecraft/[a-z][a-z0-9_]*/data/minecraft)/${nativeSettings}|dimensions/minecraft/[a-z][a-z0-9_]*/(?:region|entities|poi)/r\.-?\d+\.-?\d+\.mca)$`,
        "u",
      ).test(file),
    "Invalid fixture file",
  );
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
export const FixtureSchema = z
  .strictObject({
    schema: z.literal(1),
    source: z.string().min(1),
    capturedAt: z.iso.datetime(),
    patches: z.array(PatchSchema).min(1),
    files: z
      .array(z.strictObject({ path: FixtureFileSchema, sha256: hash }))
      .min(1),
  })
  .superRefine((fixture, context) => {
    if (
      new Set(fixture.files.map((f) => f.path)).size !== fixture.files.length ||
      !fixture.files.some((f) => f.path === "level.dat")
    )
      context.addIssue({
        code: "custom",
        message: "Fixture files are duplicate or lack level.dat",
      });
  });
export type FixtureSource = {
  id: string;
  list: (world: string, layer: string) => Promise<string[]>;
  metadata: (worlds: string[]) => Promise<string[]>;
  read: (file: string) => Promise<Uint8Array>;
};

function canonicalPatches(values: TerrainPatch[]): string {
  return JSON.stringify(
    values
      .map((p) => JSON.stringify([p.world, p.min, p.max, p.paddingChunks]))
      .sort(),
  );
}

/** An explicit replay fixture must cover exactly the currently authored terrain. */
export async function verifyFixturePatches(
  store: BlobStore,
  cache: string,
  fixtureHash: string,
  patches: TerrainPatch[],
): Promise<void> {
  const fixture = FixtureSchema.parse(
    await Bun.file(await cachedBlob(store, cache, fixtureHash)).json(),
  );
  if (canonicalPatches(fixture.patches) !== canonicalPatches(patches))
    throw new Error(
      "Pinned terrain patches differ from the suite; capture a fresh fixture",
    );
}
export function worldFolder(world: string): string {
  return world === "world" ? "overworld" : world;
}

async function retainWorldFile(
  source: FixtureSource,
  file: string,
  store: BlobStore,
) {
  const bytes = await source.read(file);
  if (file.endsWith(".dat"))
    validateNbt(gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 }));
  return { path: file, sha256: await retainBlob(store, bytes) };
}

export function localFixtureSource(directory: string): FixtureSource {
  const root = path.resolve(directory);
  const confined = async (relative: string) => {
    const absolute = path.join(await realpath(root), relative);
    if ((await realpath(absolute)) !== absolute)
      throw new Error("Linked fixture path");
    return absolute;
  };
  const metadata = async (relative: string): Promise<string[]> => {
    const folder = await confined(relative);
    const files: string[] = [];
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Linked fixture path");
      if (entry.isDirectory()) files.push(...(await metadata(file)));
      else if (entry.isFile() && FixtureFileSchema.safeParse(file).success)
        files.push(file);
    }
    return files;
  };
  return {
    id: root,
    metadata: async (worlds) => {
      z.array(z.string().regex(/^[a-z][a-z0-9_]*$/u)).parse(worlds);
      const files: string[] = [];
      for (const folder of [
        "data/minecraft",
        "datapacks",
        ...new Set(
          worlds.map(
            (world) =>
              `dimensions/minecraft/${worldFolder(world)}/data/minecraft`,
          ),
        ),
      ]) {
        try {
          files.push(...(await metadata(folder)));
        } catch (error) {
          if (!(
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          ))
            throw error;
        }
      }
      return files;
    },
    list: async (world, layer) => {
      z.string()
        .regex(/^[a-z][a-z0-9_]*$/u)
        .parse(world);
      z.enum(["region", "entities", "poi"]).parse(layer);
      const folder = path.join(
        root,
        "dimensions/minecraft",
        worldFolder(world),
        layer,
      );
      try {
        return await readdir(await confined(path.relative(root, folder)));
      } catch (error) {
        if (
          layer !== "region" &&
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return [];
        throw error;
      }
    },
    read: async (file) => {
      FixtureFileSchema.parse(file);
      const absolute = await confined(file);
      const stat = await lstat(absolute);
      if (!stat.isFile())
        throw new Error("Fixture source is not a regular file");
      return new Uint8Array(await readFile(absolute));
    },
  };
}

function rememberTerrain(
  cropped: Buffer,
  location: { world: string; rx: number; rz: number },
  terrain: Set<string>,
) {
  const { world, rx, rz } = location;
  for (let i = 0; i < 1024; i++)
    if (cropped.readUInt32BE(i * 4) !== 0)
      terrain.add(
        columnKey(world, rx * 32 + (i % 32), rz * 32 + Math.floor(i / 32)),
      );
}
async function retainLayer(
  source: FixtureSource,
  patches: TerrainPatch[],
  store: BlobStore,
  context: {
    world: string;
    layer: "region" | "entities" | "poi";
    terrain: Set<string>;
  },
) {
  const { world, layer, terrain } = context;
  const files: { path: string; sha256: string }[] = [];
  const names = await source.list(world, layer);
  for (const name of names.toSorted()) {
    const match = /^r\.(-?\d+)\.(-?\d+)\.mca$/u.exec(name);
    if (match === null) throw new Error(`Unexpected region file ${name}`);
    const rx = Number(match[1]),
      rz = Number(match[2]);
    const relevant = Array.from(
      { length: 1024 },
      (_, i) => [rx * 32 + (i % 32), rz * 32 + Math.floor(i / 32)] as const,
    ).some(([x, zz]) => includesChunk(patches, world, x, zz));
    if (!relevant) continue;
    const file = `dimensions/minecraft/${worldFolder(world)}/${layer}/${name}`;
    const cropped = cropRegion(
      await source.read(file),
      { x: rx, z: rz, layer },
      (x, zz) => includesChunk(patches, world, x, zz),
    );
    if (layer === "region")
      rememberTerrain(cropped, { world, rx, rz }, terrain);
    if (cropped.length > 8192)
      files.push({ path: file, sha256: await retainBlob(store, cropped) });
  }
  return files;
}
export async function retainFixture(
  source: FixtureSource,
  patches: TerrainPatch[],
  store: BlobStore,
): Promise<string> {
  patches.forEach((p) => PatchSchema.parse(p));
  const files = [await retainWorldFile(source, "level.dat", store)];
  const worlds = new Set(patches.map((p) => worldFolder(p.world)));
  const metadataFiles = await source.metadata(patches.map((p) => p.world));
  for (const file of metadataFiles.toSorted()) {
    FixtureFileSchema.parse(file);
    if (file === "level.dat" || /\/(?:region|entities|poi)\//u.test(file))
      continue;
    const dimension = /^dimensions\/minecraft\/([^/]+)\//u.exec(file)?.[1];
    if (dimension !== undefined && !worlds.has(dimension)) continue;
    files.push(await retainWorldFile(source, file, store));
  }
  const terrain = new Set<string>();
  for (const world of new Set(patches.map((p) => p.world))) {
    for (const layer of ["region", "entities", "poi"] as const)
      files.push(
        ...(await retainLayer(source, patches, store, {
          world,
          layer,
          terrain,
        })),
      );
  }
  verifyCoverage(patches, terrain);
  const manifest = FixtureSchema.parse({
    schema: 1,
    source: source.id,
    capturedAt: new Date().toISOString(),
    patches,
    files,
  });
  return retainBlob(store, new TextEncoder().encode(JSON.stringify(manifest)));
}

export async function restoreFixture(
  store: BlobStore,
  cache: string,
  fixtureHash: string,
  destination: string,
): Promise<void> {
  const manifest = FixtureSchema.parse(
    await Bun.file(await cachedBlob(store, cache, fixtureHash)).json(),
  );
  await mkdir(destination, { recursive: false, mode: 0o700 });
  await mkdir(path.join(destination, "data"));
  await mkdir(path.join(destination, "datapacks"));
  for (const file of manifest.files) {
    const target = path.join(destination, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await Bun.write(
      target,
      Bun.file(await cachedBlob(store, cache, file.sha256)),
    );
  }
}
