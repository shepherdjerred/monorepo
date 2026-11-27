import assert from "node:assert/strict";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { actorSha256 as sha256 } from "./archived-actor-sources.mjs";
import { readExactMapBin } from "./exact-map-bin.mjs";
import {
  bindMap11BarracksDefinitions,
  readMap11PlaceableInventory,
} from "./map11-world-catalog.mjs";
import { currentTerrainPositionBuild } from "./research/native-terrain-byte-codecs.mjs";

const kind = "exact-native-terrain-lane-minion-model-catalog";
const source = {
  schema: 1,
  build: currentTerrainPositionBuild,
  archive: "DATA/FINAL/Maps/Shipping/Map11.wad.client",
  installedExeSha256:
    "f0fd2b02e3bb69d4573629c0daca863cc010556a1dbdd28ef3ef24ef10b9b733",
  archiveIndexSha256:
    "bd7d3d901aa1c96eb7f4969fdafedf500f99f636b1653ea45233274ac34e8b92",
  materialsSha256:
    "ed38cba7aaa4390e8b2a2cfe778d5f1151152b9b97f2c90883c17b27b510d67a",
  mapBinSha256:
    "bf4b0fdfe1070103cad2d5f1e36a637f7c0d11a565f841acdbe3738fac6fe69d",
};

async function readPinned(path, digest) {
  assert.match(digest, /^[a-f0-9]{64}$/u);
  const bytes = await readFile(path);
  assert.equal(sha256(bytes), digest, "Lane catalog source digest differs");
  return bytes;
}

function catalogModels(manifest) {
  for (const [field, expected] of Object.entries(source))
    assert.equal(manifest[field], expected, `Lane catalog ${field} differs`);
  assert.ok(
    Array.isArray(manifest.models) &&
      manifest.models.length > 0 &&
      manifest.models.length <= 8,
  );
  const ids = new Set();
  for (const { modelId, model, skinId, inputs } of manifest.models) {
    assert.match(
      modelId,
      /^sru_(?:order|chaos)minion(?:melee|ranged|siege|super)$/u,
    );
    assert.ok(!ids.has(modelId), "Duplicate authored lane model");
    ids.add(modelId);
    assert.equal(model.file, `${modelId}-0/model.glb`);
    assert.equal(skinId, 0);
    assert.equal(inputs.skin.archive, source.archive);
    assert.equal(
      inputs.skin.file,
      `data/characters/${modelId}/skins/skin0.bin`,
    );
    assert.match(inputs.skin.sha256, /^[a-f0-9]{64}$/u);
  }
  return manifest.models;
}

export async function readCurrentLaneMinionCatalog(
  path,
  digest,
  materialsPath,
  mapPath,
) {
  const [catalogBytes, materials, map] = await Promise.all([
    readPinned(path, digest),
    readPinned(materialsPath, source.materialsSha256),
    readPinned(mapPath, source.mapBinSha256),
  ]);
  const manifest = JSON.parse(catalogBytes);
  assert.equal(manifest.kind, kind);
  assert.deepEqual(
    Object.keys(manifest).sort(),
    [...Object.keys(source), "kind", "models"].sort(),
  );
  const models = catalogModels(manifest);
  const { registration } = bindMap11BarracksDefinitions(
    readMap11PlaceableInventory(readExactMapBin(materials), "09e8f830"),
    readExactMapBin(map),
  );
  const barracksPlacements = registration
    .filter(({ kind }) => kind === "barracks")
    .map(({ transform, units }) => ({
      transform,
      units: Object.fromEntries(
        Object.entries(units).map(([classId, { asset }]) => [
          classId,
          { asset },
        ]),
      ),
    }));
  assert.equal(barracksPlacements.length, 6);
  const assets = new Set(
    barracksPlacements.flatMap(({ units }) =>
      Object.values(units).map(({ asset }) => asset),
    ),
  );
  assert.equal(assets.size, 8);
  assert.deepEqual(
    new Set(models.map(({ modelId }) => `${modelId}/0`)),
    assets,
    "Lane catalog must cover all authored barracks models",
  );
  return { models, barracksPlacements };
}

if (import.meta.main) {
  const [outputPath, ...inputs] = process.argv.slice(2);
  assert.ok(
    outputPath && inputs.length >= 2 && inputs.length % 2 === 0,
    "Usage: bun native-terrain-lane-minion-catalog.mjs <new private catalog directory> <prepared manifest> <manifest SHA-256> [<prepared manifest> <manifest SHA-256> ...]",
  );
  const destination = resolve(outputPath);
  const cache = await realpath(".cache");
  const parent = await realpath(dirname(destination));
  const privatePath = relative(cache, parent);
  assert.ok(
    privatePath !== ".." &&
      !privatePath.startsWith(`..${sep}`) &&
      resolve(cache, privatePath) === parent,
    "Lane catalog destination must be inside private .cache",
  );
  const entries = new Map();
  for (let index = 0; index < inputs.length; index += 2) {
    const [prepared, digest] = inputs.slice(index, index + 2);
    const manifest = JSON.parse(await readPinned(prepared, digest));
    assert.equal(manifest.kind, "exact-native-terrain-lane-minion-assets");
    for (const {
      modelId,
      model,
      skinId,
      inputs,
      skinScale,
      hiddenRanges,
    } of catalogModels(manifest)) {
      const entry = {
        modelId,
        model,
        skinId,
        inputs: { skin: inputs.skin },
        skinScale,
        hiddenRanges,
      };
      const bytes = await readPinned(
        join(dirname(prepared), entry.model.file),
        entry.model.sha256,
      );
      assert.equal(bytes.length, entry.model.bytes);
      if (entries.has(entry.modelId))
        assert.deepEqual(entries.get(entry.modelId).entry, entry);
      else entries.set(entry.modelId, { entry, bytes });
    }
  }
  assert.equal(entries.size, 8, "All authored lane models are required");
  const models = [...entries.keys()]
    .sort()
    .map((modelId) => entries.get(modelId).entry);
  await mkdir(destination);
  for (const { modelId, model } of models) {
    await mkdir(join(destination, dirname(model.file)));
    await writeFile(join(destination, model.file), entries.get(modelId).bytes, {
      flag: "wx",
    });
  }
  const output = JSON.stringify({ ...source, kind, models });
  await writeFile(join(destination, "manifest.json"), output, { flag: "wx" });
  console.log(sha256(output));
}
