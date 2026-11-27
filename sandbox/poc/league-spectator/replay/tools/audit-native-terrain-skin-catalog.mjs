import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { mapBinHash } from "./map-scene-assets.mjs";
import {
  championArchiveExecutableHashes,
  openChampionModelCatalog,
} from "./research/native-terrain-champion-model-catalog.mjs";
import {
  currentTerrainPositionBuild,
  terrainPositionProtocol,
} from "./research/native-terrain-byte-codecs.mjs";

const digestPattern = /^[a-f0-9]{64}$/;
const sha256 = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const maxManifestBytes = 32 * 1024 ** 2;
const maxResourceBytes = 128 * 1024 ** 2;

async function readManifest(path, digest, kind) {
  assert.match(digest, digestPattern);
  const file = Bun.file(path);
  assert.ok(file.size > 0 && file.size <= maxManifestBytes);
  const bytes = await file.bytes();
  assert.equal(sha256(bytes), digest, `Unverified catalog input: ${kind}`);
  const manifest = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  assert.equal(manifest.schema, 1);
  assert.equal(manifest.kind, kind);
  assert.equal(manifest.build, currentTerrainPositionBuild);
  assert.equal(manifest.protocol, terrainPositionProtocol);
  assert.ok(
    !Object.hasOwn(manifest, "replaySha256"),
    "Expected a build-scoped input",
  );
  return manifest;
}

function skinKey({ champion, skinId }) {
  assert.match(champion, /^[a-z0-9_]+$/i);
  assert.ok(Number.isInteger(skinId) && skinId >= 0 && skinId <= 10000);
  return `${champion.toLowerCase()}-${skinId}`;
}

function indexSelection(rows) {
  assert.ok(Array.isArray(rows) && rows.length > 0);
  const indexed = new Map();
  for (const row of rows) {
    const key = skinKey(row);
    assert.ok(!indexed.has(key), `Duplicate selected skin: ${key}`);
    indexed.set(key, row);
  }
  return indexed;
}

async function verifyResource(root, key, resource) {
  assert.ok(resource.file.startsWith(`${key}/`));
  assert.match(resource.sha256, digestPattern);
  assert.ok(
    Number.isInteger(resource.bytes) &&
      resource.bytes > 0 &&
      resource.bytes <= maxResourceBytes,
  );
  const filePath = await realpath(join(root, resource.file));
  assert.ok(
    relative(root, filePath).startsWith(key + sep),
    "Skin resource escapes its canonical directory",
  );
  const file = Bun.file(filePath);
  assert.equal(
    file.size,
    resource.bytes,
    `Incorrect skin resource size: ${key}`,
  );
  assert.equal(
    sha256(await file.bytes()),
    resource.sha256,
    `Incorrect skin resource digest: ${key}`,
  );
}

function verifyMaterialRanges(asset, archive, defaultTexture, key) {
  assert.ok(
    Array.isArray(asset.ranges) && asset.ranges.length > 0,
    `Missing converted material ranges: ${key}`,
  );
  for (const range of asset.ranges) {
    const { texture } = range;
    assert.ok(
      range.unresolved === undefined && texture,
      `Unresolved converted material range: ${key}`,
    );
    assert.match(texture.sha256, digestPattern);
    assert.match(texture.pngSha256, digestPattern);
    assert.ok(
      Number.isInteger(texture.bytes) &&
        texture.bytes > 0 &&
        texture.bytes <= maxResourceBytes,
    );
    switch (texture.origin) {
      case "skin-texture":
        assert.ok(defaultTexture, `Unregistered skin texture range: ${key}`);
        for (const field of ["reference", "bytes", "sha256"])
          assert.deepEqual(texture[field], defaultTexture[field]);
        break;
      case "linked-material-base-color":
        assert.ok(
          range.materialLink &&
            range.material &&
            typeof range.sampler === "string" &&
            range.sampler.length > 0,
          `Missing linked material evidence: ${key}`,
        );
        break;
      case "submesh-texture":
        assert.ok(
          archive.materialOverrideCount > 0,
          `Missing authored submesh override: ${key}`,
        );
        break;
      default:
        throw Error(`Unknown converted texture origin: ${key}`);
    }
  }
}

export async function auditNativeTerrainSkinCatalog({
  censusPath,
  censusDigest,
  selectionPath,
  selectionDigest,
  inputsPath,
  inputsDigest,
  catalogPath,
  catalogDigest,
}) {
  const [census, selection, inputs] = await Promise.all([
    readManifest(
      censusPath,
      censusDigest,
      "exact-native-terrain-archived-skin-census",
    ),
    readManifest(
      selectionPath,
      selectionDigest,
      "exact-native-terrain-skin-selection",
    ),
    readManifest(inputsPath, inputsDigest, "exact-native-terrain-skin-inputs"),
  ]);
  const { catalog, readModel } = await openChampionModelCatalog(
    catalogPath,
    catalogDigest,
    census,
    [],
    { maxManifestBytes, maxModelBytes: maxResourceBytes },
  );
  for (const manifest of [census, inputs, catalog])
    assert.equal(
      manifest.installedExeSha256,
      championArchiveExecutableHashes[currentTerrainPositionBuild],
    );
  for (const manifest of [inputs, catalog]) {
    assert.equal(manifest.selectionKind, "archive");
    assert.equal(manifest.sourceCensusSha256, censusDigest);
    assert.equal(manifest.selectionSha256, selectionDigest);
    assert.equal(manifest.nativeOpening, undefined);
  }
  assert.equal(catalog.sourceManifestSha256, inputsDigest);

  const archiveRows = [];
  const championNames = new Set();
  for (const root of census.archiveRoots) {
    const { champion, archive, archiveIndexSha256, skins } = root;
    const name = champion.toLowerCase();
    assert.ok(!championNames.has(name), `Duplicate champion archive: ${name}`);
    championNames.add(name);
    assert.equal(archive, `DATA/FINAL/Champions/${champion}.wad.client`);
    assert.match(archiveIndexSha256, digestPattern);
    assert.ok(skins.some(({ skinId }) => skinId === 0));
    for (const skin of skins) {
      const rootPath = `Characters/${champion}/Skins/Skin${skin.skinId}`;
      assert.equal(skin.rootPathHash, mapBinHash(rootPath));
      assert.match(skin.sourceSha256, digestPattern);
      archiveRows.push({
        ...skin,
        champion,
        archive,
        archiveIndexSha256,
        rootPath,
      });
    }
  }
  const archived = indexSelection(archiveRows);
  assert.equal(archived.size, census.coverage.typedSkins);
  assert.equal(championNames.size, census.coverage.championArchives);
  const selected = indexSelection(selection.skins);
  const prepared = indexSelection(inputs.skins);
  const keys = [...selected.keys()].sort();
  assert.deepEqual(
    [...prepared.keys()].sort(),
    keys,
    "Prepared skins differ from the selection",
  );
  assert.deepEqual(
    Object.keys(catalog.assets).sort(),
    keys,
    "Converted skins differ from the selection",
  );

  const root = await realpath(dirname(inputsPath));
  const assetRoot = await realpath(dirname(catalogPath));
  for (const [index, key] of keys.entries()) {
    const archive = archived.get(key);
    assert.ok(
      archive,
      `Selected skin is absent from the exact archive census: ${key}`,
    );
    const input = prepared.get(key);
    for (const field of [
      "champion",
      "skinId",
      "archive",
      "archiveIndexSha256",
      "rootPath",
      "materialOverrideCount",
    ])
      assert.equal(
        input[field],
        archive[field],
        `Skin input differs from its archive: ${key}/${field}`,
      );
    const { skin, simpleSkin, skeleton, defaultTexture } = input.resources;
    assert.equal(
      skin.reference,
      `data/characters/${archive.champion.toLowerCase()}/skins/skin${archive.skinId}.bin`,
    );
    assert.equal(skin.sha256, archive.sourceSha256);
    assert.deepEqual(simpleSkin.reference, archive.simpleSkin);
    assert.deepEqual(skeleton.reference, archive.skeleton);
    if (archive.texture === null) {
      assert.equal(
        defaultTexture,
        undefined,
        `Unregistered default texture: ${key}`,
      );
    } else {
      assert.ok(defaultTexture, `Missing authored default texture: ${key}`);
      assert.deepEqual(defaultTexture.reference, archive.texture);
    }
    await Promise.all(
      Object.values(input.resources).map((resource) =>
        verifyResource(root, key, resource),
      ),
    );
    const asset = catalog.assets[key];
    assert.equal(asset.archiveIndexSha256, archive.archiveIndexSha256);
    assert.equal(asset.skinScale, input.skinScale);
    assert.deepEqual(asset.inputs, {
      skin,
      simpleSkin,
      skeleton,
      ...(defaultTexture === undefined ? {} : { texture: defaultTexture }),
    });
    verifyMaterialRanges(asset, archive, defaultTexture, key);
    assert.equal(asset.jointBindings.file, `${key}/joint-bindings.json`);
    await verifyResource(assetRoot, key, asset.jointBindings);
    await readModel({
      champion: archive.champion,
      skinId: archive.skinId,
      context: index + 1,
    });
  }
  const uncoveredBaseKeys = [];
  const uncoveredSkinKeys = [];
  for (const key of [...archived.keys()].sort()) {
    if (selected.has(key)) continue;
    (archived.get(key).skinId === 0
      ? uncoveredBaseKeys
      : uncoveredSkinKeys
    ).push(key);
  }
  const selectedBases = [...selected.values()].filter(
    ({ skinId }) => skinId === 0,
  ).length;
  return {
    schema: 1,
    kind: "exact-native-terrain-archived-skin-coverage",
    build: census.build,
    protocol: census.protocol,
    sourceDigests: {
      census: censusDigest,
      selection: selectionDigest,
      inputs: inputsDigest,
      catalog: catalogDigest,
    },
    archived: {
      championArchives: championNames.size,
      typedSkinRoots: archived.size,
      baseKeys: championNames.size,
      alternateSkinKeys: archived.size - championNames.size,
    },
    verified: {
      selectedKeys: selected.size,
      preparedKeys: prepared.size,
      renderBindings: keys.length,
      baseKeys: selectedBases,
      alternateSkinKeys: selected.size - selectedBases,
      keys,
    },
    uncoveredBaseKeys,
    uncoveredSkinKeys,
    scope:
      "Structural coverage of bounded archive roots, pinned source resources and exact catalog bindings. Match legality and native presentation are unverified.",
  };
}

if (import.meta.main) {
  const [
    censusPath,
    censusDigest,
    selectionPath,
    selectionDigest,
    inputsPath,
    inputsDigest,
    catalogPath,
    catalogDigest,
    ...extra
  ] = process.argv.slice(2);
  if (!catalogDigest || extra.length)
    throw Error(
      "Usage: bun audit-native-terrain-skin-catalog.mjs <census> <sha256> <selection> <sha256> <inputs> <sha256> <catalog> <sha256>",
    );
  const report = await auditNativeTerrainSkinCatalog({
    censusPath,
    censusDigest,
    selectionPath,
    selectionDigest,
    inputsPath,
    inputsDigest,
    catalogPath,
    catalogDigest,
  });
  console.log(JSON.stringify(report));
}
