import assert from "node:assert/strict";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { actorSha256 as sha256 } from "./archived-actor-sources.mjs";
import { currentTerrainPositionBuild } from "./research/native-terrain-byte-codecs.mjs";
import { openLocalWad } from "./wad.mjs";

const identity = {
  schema: 1,
  kind: "exact-native-terrain-neutral-model-catalog",
  build: currentTerrainPositionBuild,
  archive: "DATA/FINAL/Maps/Shipping/Map11.wad.client",
  installedExeSha256:
    "f0fd2b02e3bb69d4573629c0daca863cc010556a1dbdd28ef3ef24ef10b9b733",
  archiveIndexSha256:
    "bd7d3d901aa1c96eb7f4969fdafedf500f99f636b1653ea45233274ac34e8b92",
};
const preparedDigests = [
  "367965d41e42351d0bbb99ef33852bf700a74c0b21c6346d0d577a4e4ef9a3f1",
  "dccafaaa8f92b0ed67b8ad9212eebe5c6d2d1ce2eb7990d2d6c9f6f5d046fcb0",
];
const reviewed = new Map([
  [
    "sru_baron",
    [
      "a5d58c0e0d186cdc8844a83f2862702f6b8e0cdf43e2ceb176f9ffa809874b24",
      0.8999999761581421,
      ["Horn", "Eye"],
    ],
  ],
  [
    "sru_riftherald",
    [
      "b7bcf8406c20e8317923a1dec8f0be17abe38fec5893e9bf410632233c90e822",
      0.800000011920929,
      [],
    ],
  ],
  [
    "sru_dragon_earth",
    [
      "cd9a2d4082bd804a88d09669d8bc86c826d7132e93a19f96fdd61d9121f2c65d",
      1.25,
      [],
    ],
  ],
  [
    "sru_dragon_chemtech",
    [
      "5065cfe9b9605bda0529f4e60a81c16943583812f38c4f5cefcfb82472d46925",
      1.25,
      [],
    ],
  ],
  [
    "sru_dragon_fire",
    [
      "bc30c9bfd1f8ea056feb5e70f0ef4787cc848ae4a737c236575064d41011eee0",
      1.25,
      [],
    ],
  ],
]);

function validateModels(models) {
  assert.ok(Array.isArray(models) && models.length === reviewed.size);
  const seen = new Set();
  for (const { modelId, model, skinScale, hiddenRanges } of models) {
    assert.ok(
      reviewed.has(modelId) && !seen.has(modelId),
      "Unverified or duplicate neutral objective model",
    );
    seen.add(modelId);
    assert.equal(model.file, modelId + "-0/model.glb");
    assert.ok(Number.isSafeInteger(model.bytes) && model.bytes > 12);
    assert.deepEqual(
      [model.sha256, skinScale, hiddenRanges],
      reviewed.get(modelId),
    );
  }
}

async function readModel(manifestPath, model) {
  const bytes = await readFile(join(dirname(manifestPath), model.file));
  assert.equal(bytes.length, model.bytes);
  assert.equal(
    sha256(bytes),
    model.sha256,
    "Neutral objective GLB digest differs",
  );
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "glTF");
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  return bytes;
}

/** Open an exact current authored catalog with an explicit omission list for requested IDs. */
export async function readCurrentNeutralModelCatalog(path, digest, modelIds) {
  assert.match(digest, /^[0-9a-f]{64}$/u);
  const bytes = await readFile(path);
  assert.equal(
    sha256(bytes),
    digest,
    "Neutral objective catalog digest differs",
  );
  const manifest = JSON.parse(bytes);
  for (const [field, expected] of Object.entries(identity))
    assert.equal(manifest[field], expected);
  assert.deepEqual(
    Object.keys(manifest).sort(),
    [...Object.keys(identity), "models"].sort(),
  );
  validateModels(manifest.models);
  const models = new Map(manifest.models.map((row) => [row.modelId, row]));
  const selected = new Map();
  const missingModelIds = [];
  for (const modelId of new Set(modelIds)) {
    assert.match(modelId, /^sru_[a-z0-9_]+$/u);
    const row = models.get(modelId);
    if (row === undefined) missingModelIds.push(modelId);
    else
      selected.set(modelId, {
        ...row,
        bytes: await readModel(path, row.model),
      });
  }
  return { models: selected, missingModelIds };
}

if (import.meta.main) {
  const [installation, objectives, dragons, output, ...extra] =
    process.argv.slice(2);
  assert.ok(
    output && !extra.length,
    "Usage: bun native-terrain-neutral-model-catalog.mjs <exact current installation> <prepared objectives manifest> <prepared dragons manifest> <new private .cache directory>",
  );
  const destination = resolve(output);
  const cache = await realpath(".cache");
  const parent = await realpath(dirname(destination));
  const privatePath = relative(cache, parent);
  assert.ok(
    privatePath !== ".." &&
      !privatePath.startsWith(".." + sep) &&
      resolve(cache, privatePath) === parent,
    "Neutral objective catalog must stay inside private .cache",
  );
  assert.equal(
    sha256(await readFile(join(installation, "Game", "League of Legends.exe"))),
    identity.installedExeSha256,
  );
  const wad = await openLocalWad(
    installation,
    identity.archive,
    Bun.zstdDecompressSync,
    identity.archiveIndexSha256,
  );
  const catalog = [];
  const glbs = new Map();
  for (const [index, path] of [objectives, dragons].entries()) {
    const source = await readFile(path);
    assert.equal(
      sha256(source),
      preparedDigests[index],
      "Prepared neutral objective manifest digest differs",
    );
    for (const {
      modelId,
      model,
      skinId,
      inputs,
      textures,
      skinScale,
      hiddenRanges,
    } of JSON.parse(source).models) {
      assert.equal(skinId, 0);
      for (const resource of [
        inputs.skin,
        inputs.simpleSkin,
        inputs.skeleton,
        ...textures,
      ]) {
        assert.equal(resource.archive, identity.archive);
        const bytes =
          resource.reference?.type === "WadChunkLink"
            ? await wad.byHash(BigInt(resource.reference.value))
            : await wad(resource.reference?.value ?? resource.file);
        assert.equal(bytes.length, resource.bytes);
        assert.equal(
          sha256(bytes),
          resource.sha256,
          "Current authored neutral resource differs: " + modelId,
        );
      }
      catalog.push({ modelId, model, skinScale, hiddenRanges });
      glbs.set(modelId, await readModel(path, model));
    }
  }
  validateModels(catalog);
  await mkdir(destination);
  for (const { modelId, model } of catalog) {
    await mkdir(join(destination, dirname(model.file)));
    await writeFile(join(destination, model.file), glbs.get(modelId), {
      flag: "wx",
    });
  }
  const manifest = JSON.stringify({ ...identity, models: catalog });
  await writeFile(join(destination, "manifest.json"), manifest, { flag: "wx" });
  console.log(sha256(manifest));
}
