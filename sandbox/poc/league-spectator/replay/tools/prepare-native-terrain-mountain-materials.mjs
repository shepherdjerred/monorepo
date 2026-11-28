import assert from "node:assert/strict";
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
import { dirname, join, relative, resolve, sep } from "node:path";
import { readExactMapBin } from "./exact-map-bin.mjs";
import { normalizeMapBin } from "./map-scene-assets.mjs";
import { openLocalWad } from "./wad.mjs";

const archiveName = "DATA/FINAL/Maps/Shipping/Map11.wad.client";
const geometryName = "data/maps/mapgeometry/map11/base_srx";
const original = {
  build: "16.23.841.8428",
  wadSha256: "61a9f97a360ab80853f8fc8fb13c4891433c1b74f8d7217f5fc34addb2414a07",
  geometrySha256:
    "d6d8d434b977ee43bbc05aeb61d586476c692585da9cf7b2971906091539d1a5",
  materialsSha256:
    "ed38cba7aaa4390e8b2a2cfe778d5f1151152b9b97f2c90883c17b27b510d67a",
  baseManifestSha256:
    "b621b18ba10f4979f50acf562cf5e42a8c750caf6e31060fc55a31a07b7112e1",
};
const mapMetadataSha256 =
  "5b3ed6a403893e7c4f38aab225aeadb96c625283956ffd010d649de9b80a3ccc";
const mapMeshSha256 =
  "437bb9c7fd9ea99268b0d2f6c417fe7af447c5645d451ee11daa7b9653d56636";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const [installation, mapRoot, baseManifest, exporter, outputRoot, ...extra] =
  process.argv.slice(2);
if (
  !installation ||
  !mapRoot ||
  !baseManifest ||
  !exporter ||
  !outputRoot ||
  extra.length
)
  throw Error(
    "Usage: bun prepare-native-terrain-mountain-materials.mjs <installation> <audited Mountain map directory> <base materials.json> <TerrainTextureMips.dll> <new private .cache directory>",
  );

const cache = resolve(".cache");
const out = resolve(outputRoot);
const relativeOutput = relative(cache, out);
assert.ok(
  relativeOutput &&
    !relativeOutput.startsWith(".." + sep) &&
    relativeOutput !== ".." &&
    resolve(cache, relativeOutput) === out,
  "Mountain material output must be private",
);
const [baseBytes, metadata, mesh] = await Promise.all([
  readFile(baseManifest),
  readFile(join(mapRoot, "map.json")),
  readFile(join(mapRoot, "map.bin")),
]);
assert.equal(digest(baseBytes), original.baseManifestSha256);
assert.equal(digest(metadata), mapMetadataSha256);
assert.equal(digest(mesh), mapMeshSha256);
const archiveHash = createHash("sha256");
for await (const chunk of createReadStream(
  join(installation, "Game", archiveName),
))
  archiveHash.update(chunk);
assert.equal(archiveHash.digest("hex"), original.wadSha256);
const archive = await openLocalWad(
  installation,
  archiveName,
  Bun.zstdDecompressSync,
);
assert.equal(
  digest(await archive(geometryName + ".mapgeo")),
  original.geometrySha256,
);
const materials = await archive(geometryName + ".materials.bin");
assert.equal(digest(materials), original.materialsSha256);

const base = JSON.parse(baseBytes);
const { meshes } = JSON.parse(metadata);
const selected = meshes.filter(({ flags }) => flags === 4);
assert.equal(selected.length, 12);
assert.equal(
  selected.filter(({ controller }) => controller === 0x48106271).length,
  9,
);
assert.equal(
  selected.filter(({ controller }) => controller === 0x1804e2e4).length,
  3,
);
const names = new Set(
  selected.flatMap(({ submeshes }) =>
    submeshes.map(({ material }) => material),
  ),
);
assert.equal(names.size, 12);
const authored = normalizeMapBin(readExactMapBin(materials), names);
const bindings = { ...base.bindings };
const textures = {};
const textureDigests = new Set();
await mkdir(out);
await mkdir(join(out, "textures"));
const work = await mkdtemp(join(out, "private-decode-"));

async function retainImage(bytes, row) {
  const sha256 = digest(bytes);
  assert.equal(sha256, row.sha256);
  assert.equal(bytes.byteLength, row.bytes);
  assert.equal(bytes.readUInt32BE(16), row.width);
  assert.equal(bytes.readUInt32BE(20), row.height);
  assert.ok(
    [row.width, row.height].every(
      (size) => Number.isSafeInteger(size) && size > 0 && size <= 512,
    ),
  );
  assert.equal(row.path, `textures/${sha256}.png`);
  if (textureDigests.has(sha256)) return;
  await writeFile(join(out, row.path), bytes, { flag: "wx" });
  textureDigests.add(sha256);
}

try {
  for (const row of Object.values(base.bindings))
    await retainImage(
      await readFile(join(dirname(baseManifest), row.path)),
      row,
    );
  const jobs = {};
  const selectedInputs = new Map();
  for (const name of names) {
    assert.ok(!Object.hasOwn(bindings, name));
    const material = authored[name];
    const diffuse = material.samplerValues.filter(({ TextureName }) =>
      /^Diffuse_?Texture$/i.test(TextureName),
    );
    assert.equal(diffuse.length, 1);
    const { kind, value } = diffuse[0].texturePath;
    assert.equal(kind, "wad-path-hash");
    const key = BigInt(value);
    const bytes = await archive.byHash(key);
    const sourceSha256 = digest(bytes);
    const raw = join(work, sourceSha256 + ".tex");
    const png = join(work, sourceSha256 + ".png");
    assert.ok(
      !Object.hasOwn(jobs, raw),
      "Expected distinct original Mountain texture sources",
    );
    await writeFile(raw, bytes, { flag: "wx" });
    jobs[raw] = png;
    textures[name] = {
      pathHash: key.toString(16).padStart(16, "0"),
      sourceSha256,
      sourceBytes: bytes.byteLength,
    };
    const alphaTest =
      material.paramValues?.find(({ name }) => name === "AlphaTestValue")
        ?.value?.[0] ?? 0;
    assert.ok(Number.isFinite(alphaTest) && alphaTest >= 0 && alphaTest <= 1);
    const pass = material.techniques?.find(
      ({ name }) => name === "normal",
    )?.passes;
    const sourceAlphaBlend = /Decal/i.test(name);
    if (sourceAlphaBlend) {
      assert.equal(pass?.length, 1);
      const [normal] = pass;
      assert.deepEqual(
        [
          normal.shader,
          normal["{23b75597}"],
          normal["{22c0c7d0}"],
          normal["{a0958d01}"],
          normal["{be0abbf5}"],
          normal["{7385e534}"],
          alphaTest,
        ],
        ["{8b183f26}", true, 6, 6, 7, 7, 0],
      );
    }
    selectedInputs.set(name, { raw, png, alphaTest, sourceAlphaBlend });
  }
  assert.equal(
    [...selectedInputs.values()].filter(
      ({ sourceAlphaBlend }) => sourceAlphaBlend,
    ).length,
    3,
  );
  const jobPath = join(work, "jobs.json");
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
  assert.equal(exitCode, 0, stderr);
  const exported = JSON.parse(stdout);
  for (const [
    name,
    { raw, png, alphaTest, sourceAlphaBlend },
  ] of selectedInputs) {
    const bytes = await readFile(png);
    const sha256 = digest(bytes);
    const row = {
      path: `textures/${sha256}.png`,
      sha256,
      bytes: bytes.byteLength,
      sourceSha256: textures[name].sourceSha256,
      ...exported[raw],
      alphaTest,
      ...(sourceAlphaBlend ? { sourceAlphaBlend: true } : {}),
    };
    await retainImage(bytes, row);
    bindings[name] = row;
  }
  let totalTriangles = 0;
  let texturedTriangles = 0;
  const used = new Set();
  for (const { hasUv, submeshes } of meshes)
    for (const { material, count } of submeshes) {
      used.add(material);
      totalTriangles += count / 3;
      if (Object.hasOwn(bindings, material)) {
        assert.equal(hasUv, true);
        texturedTriangles += count / 3;
      } else {
        assert.ok(Object.hasOwn(base.unsupported, material));
      }
    }
  assert.equal(
    used.size,
    Object.keys(bindings).length + Object.keys(base.unsupported).length,
  );
  const coverage = {
    totalTriangles,
    texturedTriangles,
    unsupportedTriangles: totalTriangles - texturedTriangles,
    materials: used.size,
    texturedMaterials: Object.keys(bindings).length,
    textures: textureDigests.size,
  };
  const manifest = JSON.stringify(
    {
      ...base,
      source: { ...base.source, mapMetadataSha256, mapMeshSha256 },
      coverage,
      bindings,
      mountainSource: { ...original, textures },
    },
    null,
    2,
  );
  await writeFile(join(out, "materials.json"), manifest, { flag: "wx" });
  console.log(JSON.stringify({ coverage, manifestSha256: digest(manifest) }));
} finally {
  for (const name of [
    "jobs.json",
    ...Object.values(textures).flatMap(({ sourceSha256 }) => [
      sourceSha256 + ".tex",
      sourceSha256 + ".png",
    ]),
  ])
    await rm(join(work, name), { force: true });
  await rmdir(work);
}
