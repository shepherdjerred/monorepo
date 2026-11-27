import assert from "node:assert/strict";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { actorSha256 as sha256 } from "./archived-actor-sources.mjs";
import { readExactMapBin } from "./exact-map-bin.mjs";
import {
  currentTerrainPositionBuild,
  terrainPositionProtocol,
} from "./research/native-terrain-byte-codecs.mjs";
import { openLocalWad } from "./wad.mjs";

const sourceManifestSha256 =
  "f3752e7450eba802ffe89447ef1298c13a5bc92bd69d177f325184c133c1e9f4";
const identity = {
  schema: 1,
  kind: "exact-native-terrain-camp-model-catalog",
  build: currentTerrainPositionBuild,
  protocol: terrainPositionProtocol,
  archive: "DATA/FINAL/Maps/Shipping/Map11.wad.client",
  installedExeSha256:
    "f0fd2b02e3bb69d4573629c0daca863cc010556a1dbdd28ef3ef24ef10b9b733",
  archiveIndexSha256:
    "bd7d3d901aa1c96eb7f4969fdafedf500f99f636b1653ea45233274ac34e8b92",
  sourceManifestSha256,
};
const reviewed = new Map([
  [
    "sru_crab",
    [0.75, "78ebaefa51173e85e35e1362c6e0465af67e2f97ad354e49e30f5c1cc627a80f"],
  ],
  [
    "sru_murkwolf",
    [
      1.2000000476837158,
      "9498a26c2f490a04e233848c656a8ea8dd68d63246605b573035e39439de033f",
    ],
  ],
  [
    "sru_murkwolfmini",
    [
      0.949999988079071,
      "e0a26f60c5228c60645db29eedf4954346dd1407d40744ee9f4fd1a7b982f8a9",
    ],
  ],
  [
    "sru_razorbeak",
    [
      1.399999976158142,
      "4ad2ba174234f758de48f5243bee5953a729f4279eadab18482c45376d249034",
    ],
  ],
  [
    "sru_razorbeakmini",
    [
      0.800000011920929,
      "b189707869c4855fa13b54996b2f787fe8859be533d0665502fc297a278f80c5",
    ],
  ],
  // Exact .8428 SkinMeshDataProperties constructor initializes skinScale to
  // 1.0 at +0x48. The original archived constructor prefix was verified offline.
  [
    "sru_horde",
    [1, "f25e52862d38fce4c12bc3e6f70a0d0cf709dd0aef98f0c4e5f5e8d188b77e6b"],
  ],
  [
    "sru_gromp",
    [
      1,
      "73da2a96b56a779558655c8b8f7e14d389261b9364673574207f2117c8ed110a",
      ["SRU_Gromp_Mini_Mat", "Toad_Spawn_Mat"],
    ],
  ],
]);
const nativeDefaultScale = new Set(["sru_horde", "sru_gromp"]);
const redirectedSkins = new Map([
  ["sru_blue", { record: "SRU_Blue", skinId: 4 }],
  ["sru_red", { record: "SRU_Red", skinId: 3 }],
]);
reviewed.set("sru_blue", [
  1.3700000047683716,
  "07e9a0c6ad216f453f5b559722a59080dd1a3d789e1548cb6ec6340eac65a287",
  ["Normal"],
]);
reviewed.set("sru_red", [
  2.075000047683716,
  "4ae3df8488a3e113a73478aa8a2601462868590a2c317ef89995bf2d5d08d27a",
  ["Normal"],
]);
const currentModelIds = new Set(
  [...reviewed.keys()].filter((modelId) => modelId !== "sru_horde"),
);
const historicalModelIds = new Set(
  [...reviewed.keys()].filter((modelId) => !redirectedSkins.has(modelId)),
);
const pin = /^[a-f0-9]{64}$/u;

async function readRegular(file) {
  const canonical = join(await realpath(dirname(file)), basename(file));
  assert.ok(
    (await lstat(canonical)).isFile() &&
      (await realpath(canonical)) === canonical,
    "Camp catalog requires an exact regular file",
  );
  return readFile(canonical);
}

function readPinnedBytes(bytes, entry) {
  assert.equal(bytes.length, entry.bytes);
  assert.match(entry.sha256, pin);
  assert.equal(sha256(bytes), entry.sha256, "Camp resource digest differs");
  return bytes;
}

function validateGlb(bytes, hiddenRanges) {
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "glTF");
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const jsonBytes = bytes.readUInt32LE(12);
  assert.ok(jsonBytes > 0 && 20 + jsonBytes <= bytes.length);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  const { buffers, images, meshes, materials } = JSON.parse(
    bytes.subarray(20, 20 + jsonBytes),
  );
  assert.ok(buffers.length === 1 && buffers[0].uri === undefined);
  assert.ok(
    images.length > 0 &&
      images.every(
        ({ uri, bufferView }) =>
          uri === undefined &&
          Number.isSafeInteger(bufferView) &&
          bufferView >= 0,
      ),
    "Camp GLB textures must remain embedded",
  );
  const groups = meshes[0].primitives.map(
    ({ material }) => materials[material].name,
  );
  const namedGroups = new Set(groups.map((name) => name.toLowerCase()));
  const hidden = new Set(hiddenRanges.map((name) => name.toLowerCase()));
  assert.ok(
    [...hidden].every((name) => namedGroups.has(name)) &&
      [...namedGroups].some((name) => !hidden.has(name)),
    "Camp GLB has incomplete authored hidden groups",
  );
  return namedGroups;
}

export async function readCurrentCampModelCatalog(
  manifestPath,
  expectedSha256,
  replayIdentity,
) {
  assert.match(expectedSha256, pin);
  assert.equal(replayIdentity.build, identity.build);
  assert.equal(replayIdentity.protocol, identity.protocol);
  const source = await readRegular(manifestPath);
  assert.equal(
    sha256(source),
    expectedSha256,
    "Camp catalog manifest digest differs",
  );
  const manifest = JSON.parse(source);
  for (const [key, value] of Object.entries(identity))
    assert.equal(manifest[key], value);
  assert.deepEqual(
    Object.keys(manifest).sort(),
    [...Object.keys(identity), "models"].sort(),
  );
  const modelKeys = new Set(manifest.models.map(({ modelId }) => modelId));
  const historical = manifest.models.length === historicalModelIds.size;
  assert.deepEqual(
    modelKeys,
    historical ? historicalModelIds : currentModelIds,
  );
  assert.equal(modelKeys.size, manifest.models.length);
  const models = new Map();
  for (const {
    modelId,
    skinId,
    requestedSkinId,
    skinScale,
    hiddenRanges,
    model,
  } of manifest.models) {
    assert.ok(
      reviewed.has(modelId) && !models.has(modelId),
      "Unknown or duplicate camp model",
    );
    assert.equal(skinId, redirectedSkins.get(modelId)?.skinId ?? 0);
    assert.equal(requestedSkinId, historical ? undefined : skinId);
    const [expectedScale, expectedDigest, expectedHidden = []] =
      reviewed.get(modelId);
    assert.deepEqual(
      [skinScale, model.sha256, hiddenRanges],
      [expectedScale, expectedDigest, expectedHidden],
    );
    assert.equal(model.file, `${modelId}-${skinId}/model.glb`);
    const bytes = readPinnedBytes(
      await readRegular(join(dirname(manifestPath), model.file)),
      model,
    );
    validateGlb(bytes, hiddenRanges);
    models.set(modelId, {
      model,
      requestedSkinId: requestedSkinId ?? skinId,
      skinId,
      skinScale,
      hiddenRanges,
      bytes,
    });
  }
  return { models };
}

function referenceKey(ref) {
  if (typeof ref === "string") return ref.toLowerCase();
  assert.equal(ref.kind, "wad-path-hash");
  assert.match(ref.value, /^[1-9]\d{0,19}$/u);
  assert.ok(BigInt(ref.value) <= 0xffff_ffff_ffff_ffffn);
  return "#" + ref.value;
}

async function verifySourceModel(modelId, source, sourceRoot, wad) {
  const skinId = redirectedSkins.get(modelId)?.skinId ?? 0;
  const asset = source.worldAssets[modelId + "/" + skinId];
  assert.equal(asset.role, "world");
  assert.equal(asset.character, modelId);
  assert.equal(asset.skinId, skinId);
  assert.equal(asset.source.wad, identity.archive);
  assert.equal(
    asset.source.skinFile,
    `data/characters/${modelId}/skins/skin${skinId}.bin`,
  );
  const prefix = `world/${modelId}/${skinId}/`;
  assert.equal(asset.skinDefinition, prefix + "skin.json");
  assert.equal(asset.materialEvidence, prefix + "material-evidence.json");
  assert.equal(asset.model, prefix + "model.glb");
  const readHistorical = async (path) => {
    const receipts = source.files.filter((entry) => entry.path === path);
    assert.equal(
      receipts.length,
      1,
      "Missing unique historical camp resource receipt",
    );
    return readPinnedBytes(
      await readRegular(join(sourceRoot, path)),
      receipts[0],
    );
  };
  const skin = JSON.parse(await readHistorical(asset.skinDefinition));
  const properties =
    skin[`Characters/${modelId}/Skins/Skin${skinId}`].skinMeshProperties;
  const [skinScale, modelDigest, hiddenRanges = []] = reviewed.get(modelId);
  assert.deepEqual(asset.hidden, hiddenRanges);
  assert.deepEqual(
    properties.initialSubmeshToHide?.split(",").filter(Boolean) ?? [],
    hiddenRanges,
  );
  const historicalScale = nativeDefaultScale.has(modelId)
    ? undefined
    : skinScale;
  assert.equal(properties.skinScale, historicalScale);
  assert.equal(asset.scale, historicalScale);
  const materials = Object.entries(
    JSON.parse(await readHistorical(asset.materialEvidence)),
  );
  const overrides = new Map(
    (properties.materialOverride ?? []).map(({ submesh, texture }) => [
      submesh.toLowerCase(),
      texture,
    ]),
  );
  for (const [name, { reference, source }] of materials) {
    const override = overrides.get(name.toLowerCase());
    assert.equal(
      source,
      override === undefined
        ? "original-skin-texture"
        : "original-submesh-texture",
    );
    assert.equal(
      referenceKey(reference),
      referenceKey(override ?? properties.texture),
    );
  }
  const references = [
    asset.source.skinFile,
    properties.simpleSkin,
    properties.skeleton,
    ...new Map(
      materials.map(([, { reference }]) => [
        referenceKey(reference),
        reference,
      ]),
    ).values(),
  ];
  for (const ref of references) {
    const receipts = source.provenance.filter(
      (entry) =>
        entry.wad === identity.archive &&
        referenceKey(entry.reference) === referenceKey(ref),
    );
    assert.equal(
      receipts.length,
      1,
      "Missing unique original camp archive receipt",
    );
    if (ref === asset.source.skinFile)
      assert.equal(receipts[0].sha256, asset.source.skinSha256);
    const bytes =
      typeof ref === "string"
        ? await wad(ref)
        : await wad.byHash(BigInt(ref.value));
    readPinnedBytes(bytes, receipts[0]);
  }
  const bytes = await readHistorical(asset.model);
  assert.equal(sha256(bytes), modelDigest);
  const groups = validateGlb(bytes, hiddenRanges);
  assert.deepEqual(
    groups,
    new Set(materials.map(([name]) => name.toLowerCase())),
  );
  return {
    modelId,
    skinId,
    requestedSkinId: skinId,
    skinScale,
    hiddenRanges,
    model: {
      file: `${modelId}-${skinId}/model.glb`,
      sha256: modelDigest,
      bytes: bytes.length,
    },
    bytes,
  };
}

async function verifyAuthoredRedirects(wad) {
  const map = readExactMapBin(await wad("data/maps/shipping/map11/map11.bin"));
  assert.equal(
    map.sourceSha256,
    "bf4b0fdfe1070103cad2d5f1e36a637f7c0d11a565f841acdbe3738fac6fe69d",
  );
  const table = map.objects.find(({ pathHash }) => pathHash === "a5773026");
  assert.equal(table.classHash, "b26bd951");
  for (const { record, skinId } of redirectedSkins.values()) {
    const rows = table.fields.c918a49c.entries.filter(
      ({ value }) =>
        value.fields["23ea1915"]?.value ===
        `Characters/${record}/CharacterRecords/Root`,
    );
    assert.equal(rows.length, 1);
    const overrides = rows[0].value.fields.bd113e91;
    assert.equal(overrides.type, "Map");
    assert.deepEqual(overrides.entries, [
      {
        key: { type: "U32", value: 0 },
        value: {
          type: "Embedded",
          classHash: "0b979c2f",
          fields: {
            "336b65b8": {
              type: "String",
              value: `Characters/${record}/Skins/Skin${skinId}`,
            },
          },
        },
      },
    ]);
  }
}

async function main(args) {
  const [installation, archivedManifest, reviewedSha256, output, ...extra] =
    args;
  assert.ok(
    output && extra.length === 0,
    "Usage: bun native-terrain-camp-model-catalog.mjs <exact current installation> <historical archived actor manifest> <reviewed manifest SHA-256> <new private .cache directory>",
  );
  assert.equal(
    reviewedSha256,
    sourceManifestSha256,
    "Historical camp manifest pin is unsupported",
  );
  const cache = await realpath(".cache");
  const destination = resolve(output);
  const parent = await realpath(dirname(destination));
  const rel = relative(cache, parent);
  assert.ok(
    rel !== ".." &&
      !rel.startsWith(".." + sep) &&
      resolve(cache, rel) === parent,
    "Camp model catalog output must stay in private .cache",
  );
  assert.equal(
    sha256(await readFile(join(installation, "Game", "League of Legends.exe"))),
    identity.installedExeSha256,
  );
  const manifest = await readRegular(archivedManifest);
  assert.equal(
    sha256(manifest),
    sourceManifestSha256,
    "Historical camp manifest digest differs",
  );
  const historical = JSON.parse(manifest);
  assert.equal(historical.kind, "archived-original-actor-assets");
  assert.equal(historical.build, "16.21.829.8620");
  const wad = await openLocalWad(
    installation,
    identity.archive,
    Bun.zstdDecompressSync,
    identity.archiveIndexSha256,
  );
  await verifyAuthoredRedirects(wad);
  const admitted = [];
  for (const modelId of currentModelIds)
    admitted.push(
      await verifySourceModel(
        modelId,
        historical,
        dirname(archivedManifest),
        wad,
      ),
    );
  const outputRoot = join(parent, basename(destination));
  await mkdir(outputRoot);
  for (const { model, bytes } of admitted) {
    const file = join(outputRoot, model.file);
    await mkdir(dirname(file));
    await writeFile(file, bytes, { flag: "wx" });
  }
  const result = JSON.stringify({
    ...identity,
    models: admitted.map(({ bytes, ...row }) => row),
  });
  await writeFile(join(outputRoot, "manifest.json"), result, { flag: "wx" });
  console.log(sha256(result));
}

if (import.meta.main) await main(process.argv.slice(2));
