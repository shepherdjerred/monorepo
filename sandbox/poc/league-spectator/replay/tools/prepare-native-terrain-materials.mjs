// Private offline preparation for the reviewed exact installed Map11 export.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rmdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { readExactMapBin } from "./exact-map-bin.mjs";
import { normalizeMapBin } from "./map-scene-assets.mjs";
import { openLocalWad } from "./wad.mjs";

const build = "16.23.840.6595";
const protocol = "8bbfcd5af2bc92db";
const wadName = "DATA/FINAL/Maps/Shipping/Map11.wad.client";
const source = {
  wadSha256: "b1e05a8b46185f5a597f1aa0a0466b4fefbe6ae1aa1711a9c61a145d4a8f94cd",
  geometrySha256:
    "d6d8d434b977ee43bbc05aeb61d586476c692585da9cf7b2971906091539d1a5",
  materialsSha256:
    "ed38cba7aaa4390e8b2a2cfe778d5f1151152b9b97f2c90883c17b27b510d67a",
  mapMetadataSha256:
    "24716f3c47ed5eadaa80693f0113dffb21dd2b5ab419957c5ae91c3a0e77ad15",
  mapMeshSha256:
    "a574779dd23f225a62a08e3fc87554aea55c3e1f1e72e63ef90a5c502b77105f",
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const [installation, mapRoot, exporter, outputRoot, ...extra] =
  process.argv.slice(2);
if (!installation || !mapRoot || !exporter || !outputRoot || extra.length)
  throw Error(
    "Usage: bun prepare-native-terrain-materials.mjs <installation> <audited map directory> <TerrainTextureMips.dll> <new private .cache directory>",
  );
const out = resolve(outputRoot);
const rel = relative(resolve(".cache"), out);
if (
  !rel ||
  rel === ".." ||
  rel.startsWith(".." + sep) ||
  resolve(".cache", rel) !== out
)
  throw Error("Material exports must stay in a private .cache directory");

const wadHash = createHash("sha256");
for await (const chunk of createReadStream(join(installation, "Game", wadName)))
  wadHash.update(chunk);
if (wadHash.digest("hex") !== source.wadSha256)
  throw Error("Installed Map11 WAD differs from the reviewed exact source");
const read = await openLocalWad(installation, wadName, Bun.zstdDecompressSync);
const geometryName = "data/maps/mapgeometry/map11/base_srx";
const materials = await read(geometryName + ".materials.bin");
const metadata = await readFile(join(mapRoot, "map.json"));
const mapMesh = await readFile(join(mapRoot, "map.bin"));
const expandedInfernalMap = {
  mapMetadataSha256:
    "4a8b2432fa3316647092fee062ff84c198f5e085ea11860aa4584082f46a889d",
  mapMeshSha256:
    "c0419c77f44277f4e0257c1dae73a24d355461b87640318231e351cba208c61c",
};
const mapDigest = hash(metadata);
const meshDigest = hash(mapMesh);
const selectedSource =
  mapDigest === expandedInfernalMap.mapMetadataSha256 &&
  meshDigest === expandedInfernalMap.mapMeshSha256
    ? { ...source, ...expandedInfernalMap }
    : source;
if (
  hash(await read(geometryName + ".mapgeo")) !==
    selectedSource.geometrySha256 ||
  hash(materials) !== selectedSource.materialsSha256 ||
  mapDigest !== selectedSource.mapMetadataSha256 ||
  meshDigest !== selectedSource.mapMeshSha256
)
  throw Error(
    "Exact installed Map11 source or export differs from its reviewed digest",
  );

const { meshes } = JSON.parse(metadata);
const submeshes = meshes.flatMap((mesh) =>
  mesh.submeshes.map((submesh) => ({ ...submesh, hasUv: mesh.hasUv })),
);
const names = new Set(submeshes.map(({ material }) => material));
const normalized = normalizeMapBin(readExactMapBin(materials), names);
const selections = new Map();
const unsupported = {};
const grompDecalMaterials = new Set(
  ["Order", "Chaos"].map(
    (team) =>
      `Maps/KitPieces/SRS/Base/Materials/Default/Earth_${team}_GrompDecal_A_MAT`,
  ),
);
for (const name of names) {
  const material = normalized[name];
  if (!material) throw Error(`Missing exact Map11 material ${name}`);
  const diffuse =
    material.samplerValues?.filter(({ TextureName }) =>
      /^Diffuse_?Texture$/i.test(TextureName),
    ) ?? [];
  if (diffuse.length !== 1) {
    unsupported[name] = {
      shader: material.techniques?.[0]?.passes?.[0]?.shader,
      reason: "No unique authored diffuse binding",
    };
    continue;
  }
  const alphaTest =
    material.paramValues?.find(({ name }) => name === "AlphaTestValue")
      ?.value?.[0] ?? 0;
  if (!Number.isFinite(alphaTest) || alphaTest < 0 || alphaTest > 1)
    throw Error(`Invalid authored alpha cutoff for ${name}`);
  const sourceAlphaBlend = grompDecalMaterials.has(name);
  if (sourceAlphaBlend) {
    const pass = material.techniques?.find(
      (technique) => technique.name === "normal",
    )?.passes;
    if (
      pass?.length !== 1 ||
      pass[0].shader !== "{8b183f26}" ||
      pass[0]["{23b75597}"] !== true ||
      pass[0]["{22c0c7d0}"] !== 6 ||
      pass[0]["{a0958d01}"] !== 6 ||
      pass[0]["{be0abbf5}"] !== 7 ||
      pass[0]["{7385e534}"] !== 7 ||
      alphaTest !== 0
    )
      throw Error(`Map11 Gromp decal blend pass differs for ${name}`);
  }
  selections.set(name, {
    reference: diffuse[0].texturePath,
    alphaTest,
    sourceAlphaBlend,
  });
}
const totalTriangles = submeshes.reduce((sum, { count }) => sum + count / 3, 0);
const texturedTriangles = submeshes.reduce(
  (sum, { material, hasUv, count }) => {
    if (!selections.has(material)) return sum;
    if (!hasUv) throw Error(`Missing authored UVs for ${material}`);
    return sum + count / 3;
  },
  0,
);

await mkdir(out);
await mkdir(join(out, "textures"));
const work = await mkdtemp(join(out, "private-work-"));
const textures = new Map();
const jobs = {};
const jobPath = join(work, "jobs.json");
try {
  for (const { reference } of selections.values()) {
    const key = JSON.stringify(reference);
    if (textures.has(key)) continue;
    const bytes =
      typeof reference === "string"
        ? await read(reference)
        : await read.byHash(BigInt(reference.value));
    const sourceSha256 = hash(bytes);
    const raw = join(work, sourceSha256 + ".tex");
    const png = join(work, sourceSha256 + ".png");
    if (!(raw in jobs)) {
      jobs[raw] = png;
      await writeFile(raw, bytes, { flag: "wx" });
    }
    textures.set(key, { sourceSha256, raw, png });
  }
  await writeFile(jobPath, JSON.stringify(jobs));
  const child = Bun.spawn(["dotnet", resolve(exporter), jobPath], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0)
    throw Error(`Exact Map11 texture export failed: ${stderr}`);
  const exported = JSON.parse(stdout);
  const outputTextures = new Set();
  for (const texture of textures.values()) {
    const png = await readFile(texture.png);
    const sha256 = hash(png);
    const path = `textures/${sha256}.png`;
    if (!outputTextures.has(path))
      await writeFile(join(out, path), png, { flag: "wx" });
    outputTextures.add(path);
    texture.file = {
      path,
      sha256,
      bytes: png.length,
      sourceSha256: texture.sourceSha256,
      ...exported[texture.raw],
    };
  }
  const bindings = Object.fromEntries(
    [...selections].map(
      ([name, { reference, alphaTest, sourceAlphaBlend }]) => [
        name,
        {
          ...textures.get(JSON.stringify(reference)).file,
          alphaTest,
          ...(sourceAlphaBlend ? { sourceAlphaBlend: true } : {}),
        },
      ],
    ),
  );
  const coverage = {
    totalTriangles,
    texturedTriangles,
    unsupportedTriangles: totalTriangles - texturedTriangles,
    materials: names.size,
    texturedMaterials: selections.size,
    textures: outputTextures.size,
  };
  const manifest = JSON.stringify(
    {
      schema: 1,
      build,
      protocol,
      source: selectedSource,
      coverage,
      bindings,
      unsupported,
    },
    null,
    2,
  );
  await writeFile(join(out, "materials.json"), manifest, { flag: "wx" });
  console.log(JSON.stringify({ coverage, manifestSha256: hash(manifest) }));
} finally {
  for (const path of [jobPath, ...Object.keys(jobs), ...Object.values(jobs)]) {
    await rm(path, { force: true });
  }
  await rmdir(work);
}
