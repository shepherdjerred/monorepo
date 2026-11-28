import assert from "node:assert/strict";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { readExactMapBin } from "../exact-map-bin.mjs";
import { mapBinHash } from "../map-scene-assets.mjs";
import { openWad } from "../wad.mjs";

const archive = "DATA/FINAL/Maps/Shipping/Map12.wad.client";
const manifestSha256 =
  "96671c4b94f274bf27b15a722934e4c1c4906b0357898e922d3b13d79ef6656c";
const archiveFileId = "E7B2B9B08F95DA73";
const ranges = ["Turret", "Stage3", "Branches", "Foliage"];
const expectedSkins = [
  {
    skin: 44,
    material: "759f7147",
    source: "360fd538345093bcdf5df270942227475c785ec90c4d02c528288eb30ddbe27c",
    animationGraph:
      "eb40e0544487fd7df1370b21fb6776ec7f65da8aaf8fa08eafb745d5fdb14ac6",
    model: "0e0b991535bf662665116c9dbff89858c14d84b8a4dcabce5a23d6a900831aca",
  },
  {
    skin: 45,
    material: "a508bbf7",
    source: "0ad16ac4461549d4e06a826bcbeebe78885aa10ce20d1c2995a2d422f2a1ce57",
    animationGraph:
      "699a256b6086596b6de6e5775f587829e5f71a71a1c6b8374f1258da7996e33e",
    model: "786d2ec6b60a56d89a2dd990af631c0f560b45a5b245a793f303fc0987e97744",
  },
];
const sha256 = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const field = (node, name) => node.fields[mapBinHash(name)];
const write = (path, bytes) => writeFile(path, bytes, { flag: "wx" });
const writeJson = (path, data) =>
  write(path, JSON.stringify(data, null, 2) + "\n");

async function archiveReader(metadataPath, chunkCache) {
  const bytes = await Bun.file(metadataPath).bytes();
  assert.equal(
    sha256(bytes),
    "25c85065433335541948f94f9ee190ae00917df020bc5d96658f1cfb9e4df9ad",
    "Expected reviewed exact Map12 release metadata",
  );
  const manifest = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  assert.equal(manifest.manifestSha256, manifestSha256);
  assert.equal(manifest.filePath, archive);
  assert.equal(manifest.fileId, archiveFileId);
  return openWad(
    {
      manifestId: manifest.manifestId,
      sourceSha256: manifestSha256,
      files: [
        {
          name: archive,
          chunks: manifest.chunks.map(({ chunkId, bundleId, ...sizes }) => ({
            id: "0x" + chunkId,
            bundleId: "0x" + bundleId,
            ...sizes,
          })),
        },
      ],
    },
    archive,
    resolve(chunkCache),
    zstdDecompressSync,
  );
}

async function exportGeometry(wad, tool, output, expected) {
  const { skin } = expected;
  const destination = join(output, `turret-${skin}`);
  const work = join(destination, "source");
  await mkdir(destination);
  await mkdir(work);
  const source = readExactMapBin(
    await wad(`data/characters/turret/skins/skin${skin}.bin`),
  );
  assert.equal(source.sourceSha256, expected.source);
  const root = source.objects.find(
    ({ pathHash }) =>
      pathHash === mapBinHash(`Characters/Turret/Skins/Skin${skin}`),
  );
  assert.equal(root?.classHash, mapBinHash("SkinCharacterDataProperties"));
  const graphPath = `DATA/Characters/Turret/Animations/Skin${skin}.bin`;
  assert.ok(source.dependencies.includes(graphPath));
  const graphSource = readExactMapBin(await wad(graphPath));
  assert.equal(graphSource.sourceSha256, expected.animationGraph);
  const graphLink = field(
    field(root, "skinAnimationProperties"),
    "animationGraphData",
  );
  assert.equal(graphLink.type, "ObjectLink");
  const graph = graphSource.objects.find(
    ({ pathHash }) => Number.parseInt(pathHash, 16) === graphLink.value,
  );
  assert.equal(graph?.classHash, mapBinHash("AnimationGraphData"));
  const destroyed = field(graph, "mClipDataMap").entries.filter(
    ({ key }) =>
      key.type === "Hash" &&
      key.value === Number.parseInt(mapBinHash("Destroyed"), 16),
  );
  assert.equal(destroyed.length, 1);
  const visibility = destroyed[0].value.fields.f598463e.entries.filter(
    ({ value }) => value.classHash === mapBinHash("SubmeshVisibilityEventData"),
  );
  assert.equal(visibility.length, 1);
  const event = visibility[0].value;
  const destroyedRanges = {
    frame: field(event, "mStartFrame")?.value ?? 0,
    show: ["Stage3"],
    hide: ["Turret", "Branches", "Foliage"],
  };
  assert.equal(destroyedRanges.frame, 0);
  for (const [property, names] of [
    ["mShowSubmeshList", destroyedRanges.show],
    ["mHideSubmeshList", destroyedRanges.hide],
  ])
    assert.deepEqual(
      field(event, property).elements.map(({ value }) => value),
      names.map((name) => Number.parseInt(mapBinHash(name), 16)),
    );
  const mesh = field(root, "skinMeshProperties");
  const overrides = field(mesh, "materialOverride").elements;
  assert.equal(overrides.length, 1);
  assert.equal(field(overrides[0], "submesh").value, "Foliage");
  const link = field(overrides[0], "Material");
  assert.equal(link.type, "ObjectLink");
  assert.equal(link.value.toString(16).padStart(8, "0"), expected.material);
  const material = source.objects.find(
    ({ pathHash }) => pathHash === expected.material,
  );
  assert.equal(material?.classHash, "ff9d3409");
  const main = material.fields["0a6f0eb5"].elements.filter(
    (row) => row.fields.b311d4ef?.value === "Main_Texture",
  );
  const clip = material.fields.d0ab46b8.elements.filter(
    (row) => field(row, "Name")?.value === "AlphaClipValue",
  );
  assert.equal(main.length, 1);
  assert.equal(clip.length, 1);
  const alphaClip = clip[0].fields["425ed3ca"].value.X;
  assert.equal(alphaClip, 0.5);

  async function extract(reference, name) {
    assert.ok(reference.type === "String" || reference.type === "WadChunkLink");
    const bytes =
      reference.type === "String"
        ? await wad(reference.value)
        : await wad.byHash(BigInt(reference.value));
    await write(join(work, name), bytes);
    return { file: name, reference, sha256: sha256(bytes) };
  }
  const inputs = {
    mesh: await extract(field(mesh, "simpleSkin"), "model.skn"),
    skeleton: await extract(field(mesh, "skeleton"), "model.skl"),
    base: await extract(field(mesh, "texture"), "base.texture"),
    foliage: await extract(main[0].fields.f0a363e3, "foliage.texture"),
  };
  const jobs = join(work, "texture-jobs.json");
  await writeJson(
    jobs,
    Object.fromEntries(
      ["base", "foliage"].map((key) => [
        join(work, inputs[key].file),
        join(work, `${key}.png`),
      ]),
    ),
  );
  await tool("Exporter.dll", "textures", jobs);
  const rangePath = join(work, "ranges.json");
  await tool("Exporter.dll", "skin-info", join(work, "model.skn"), rangePath);
  assert.deepEqual(await Bun.file(rangePath).json(), ranges);
  await writeJson(
    join(work, "texture-bindings.json"),
    Object.fromEntries(
      ranges.map((range) => [
        range,
        range === "Foliage" ? "foliage.png" : "base.png",
      ]),
    ),
  );
  const glb = join(destination, "authored-geometry.glb");
  const jointPath = join(destination, "joint-bindings.json");
  await tool("OrdinalModelExporter.dll", work, glb, jointPath);
  const joints = await Bun.file(jointPath).json();
  assert.equal(joints.meshSha256, inputs.mesh.sha256);
  assert.equal(joints.rigSha256, inputs.skeleton.sha256);
  assert.equal(joints.modelSha256, expected.model);
  assert.equal(sha256(await Bun.file(glb).bytes()), expected.model);
  return {
    skin,
    skinBinSha256: source.sourceSha256,
    modelSha256: expected.model,
    ranges,
    inputs,
    foliageMaterial: expected.material,
    alphaClip,
    animationGraph: {
      path: graphPath,
      sha256: expected.animationGraph,
      destroyedRanges,
    },
  };
}

const [metadata, chunkCache, tools, output, ...extra] = process.argv.slice(2);
assert.ok(
  output && extra.length === 0,
  "Usage: bun prepare-mayhem-bloom-turret-geometry.mjs <reviewed release metadata.json> <RMAN cache> <ordinal exporter directory> <new .cache child>",
);
const destination = resolve(output);
const cache = await realpath(".cache");
assert.equal(dirname(destination), cache);
const exporter = resolve(tools);
const runtime = join(exporter, "OrdinalModelExporter.runtimeconfig.json");
assert.ok(
  await Bun.file(runtime).exists(),
  "Ordinal exporter runtime is required",
);
const wad = await archiveReader(metadata, chunkCache);
await mkdir(destination);
async function tool(executable, ...args) {
  const child = Bun.spawn(
    [
      "dotnet",
      "exec",
      "--runtimeconfig",
      runtime,
      join(exporter, executable),
      ...args,
    ],
    { cwd: destination, stdout: "inherit", stderr: "inherit" },
  );
  assert.equal(await child.exited, 0, `${executable} failed`);
}
const models = [];
for (const expected of expectedSkins)
  models.push(await exportGeometry(wad, tool, destination, expected));
await writeJson(join(destination, "geometry-receipt.json"), {
  kind: "mayhem-bloom-offline-turret-geometry",
  manifestSha256,
  archiveFileId,
  models,
  unresolved: [
    "foliage shader",
    "opening stage activation",
    "live instance scale",
  ],
  chunks: wad.rmanReceipts(),
});
