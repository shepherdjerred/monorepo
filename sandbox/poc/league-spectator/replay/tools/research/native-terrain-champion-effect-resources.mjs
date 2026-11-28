import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { readExactMapBin } from "../exact-map-bin.mjs";
import { mapBinHash } from "../map-scene-assets.mjs";
import { openLocalWad } from "../wad.mjs";
import { terrainPositionProtocol } from "./native-terrain-byte-codecs.mjs";
import {
  currentChampionBuild,
  openChampionModelCatalog,
} from "./native-terrain-champion-model-catalog.mjs";

const digestPattern = /^[a-f0-9]{64}$/;
const hex = (value) => value.toString(16).padStart(8, "0");
const skinClass = mapBinHash("SkinCharacterDataProperties");
const resolverClass = mapBinHash("ResourceResolver");
const vfxClass = mapBinHash("VfxSystemDefinitionData");
const resolverField = mapBinHash("mResourceResolver");
const resourceMapField = mapBinHash("resourceMap");
const particleNameField = mapBinHash("particleName");
const particlePathField = mapBinHash("particlePath");

function findObject(bin, pathHash, classHash) {
  const matches = bin.objects.filter((object) => object.pathHash === pathHash);
  assert.equal(matches.length, 1, `Expected a unique BIN object ${pathHash}`);
  assert.equal(
    matches[0].classHash,
    classHash,
    `Unexpected class for ${pathHash}`,
  );
  return matches[0];
}

async function compileSkin(installation, name, asset) {
  const { champion, skinId, archiveIndexSha256 } = asset;
  assert.match(champion, /^[a-z0-9_]+$/i);
  assert.ok(Number.isSafeInteger(skinId) && skinId >= 0 && skinId <= 10000);
  assert.equal(name, `${champion.toLowerCase()}-${skinId}`);
  assert.match(archiveIndexSha256, digestPattern);
  const archive = `DATA/FINAL/Champions/${champion}.wad.client`;
  const rootPath = `data/characters/${champion.toLowerCase()}/skins/skin${skinId}.bin`;
  const rootObjectPath = `Characters/${champion}/Skins/Skin${skinId}`;
  const skinSource = asset.inputs.skin;
  assert.equal(skinSource.reference.toLowerCase(), rootPath);
  assert.match(skinSource.sha256, digestPattern);
  const wad = await openLocalWad(
    installation,
    archive,
    Bun.zstdDecompressSync,
    archiveIndexSha256,
  );
  const rootBytes = await wad(rootPath);
  assert.equal(rootBytes.length, skinSource.bytes);
  const root = readExactMapBin(rootBytes);
  assert.equal(root.sourceSha256, skinSource.sha256);
  const rootObjectPathHash = mapBinHash(rootObjectPath);
  const skin = findObject(root, rootObjectPathHash, skinClass);
  const resolverLink = skin.fields[resolverField];
  assert.equal(resolverLink?.type, "ObjectLink");
  assert.ok(resolverLink.value, "Skin root has a null resource resolver");
  const resolverPathHash = hex(resolverLink.value);
  const resolver = findObject(root, resolverPathHash, resolverClass);
  const resourceMap = resolver.fields[resourceMapField];
  assert.equal(resourceMap?.type, "Map");
  const bindings = new Map();
  for (const { key, value } of resourceMap.entries) {
    assert.equal(key.type, "Hash");
    assert.equal(value.type, "ObjectLink");
    const resourceKey = hex(key.value);
    assert.ok(
      !bindings.has(resourceKey),
      `Duplicate resource key ${resourceKey}`,
    );
    bindings.set(resourceKey, value.value === 0 ? null : hex(value.value));
  }

  const sources = new Map([[rootPath, root]]);
  const missingDependencies = new Set();
  for (const bin of sources.values()) {
    for (const dependency of bin.dependencies) {
      const path = dependency.toLowerCase();
      assert.match(path, /^data\/(?:[a-z0-9_-]+\/)*[a-z0-9_.-]+\.bin$/);
      if (sources.has(path) || missingDependencies.has(path)) continue;
      if (!wad.has(path)) missingDependencies.add(path);
      else sources.set(path, readExactMapBin(await wad(path)));
    }
  }

  const candidates = new Map();
  const targets = new Set(bindings.values());
  for (const [path, bin] of sources) {
    for (const object of bin.objects) {
      if (!targets.has(object.pathHash)) continue;
      const source = {
        path,
        sha256: bin.sourceSha256,
        classHash: object.classHash,
      };
      if (object.classHash === vfxClass) {
        const nameField = object.fields[particleNameField];
        const pathField = object.fields[particlePathField];
        assert.ok(nameField === undefined || nameField.type === "String");
        assert.ok(pathField === undefined || pathField.type === "String");
        source.particleName = nameField?.value ?? null;
        source.particlePath = pathField?.value ?? null;
      }
      const matches = candidates.get(object.pathHash);
      if (matches === undefined) candidates.set(object.pathHash, [source]);
      else matches.push(source);
    }
  }

  const rows = Array.from(bindings, ([key, target]) => {
    const matches = candidates.get(target) ?? [];
    const row = { key, target };
    if (target === null) return { ...row, status: "null", source: null };
    if (matches.length === 0)
      return { ...row, status: "unresolved", source: null };
    if (matches.length > 1)
      return { ...row, status: "ambiguous", source: null, candidates: matches };
    const [source] = matches;
    return {
      ...row,
      status: source.classHash === vfxClass ? "vfx" : "non-vfx",
      source,
    };
  });
  return {
    champion,
    skinId,
    archive,
    archiveIndexSha256,
    root: {
      path: rootPath,
      sha256: root.sourceSha256,
      objectPath: rootObjectPath,
      objectPathHash: rootObjectPathHash,
    },
    resolverPathHash,
    sources: Array.from(sources, ([path, bin]) => ({
      path,
      sha256: bin.sourceSha256,
    })),
    missingDependencies: [...missingDependencies],
    rows,
  };
}

/** Compile authored resolver bindings from the reviewed local archive selections. */
export async function compileChampionEffectResources({
  installation,
  catalogPath,
  catalogSha256,
}) {
  const identity = {
    build: currentChampionBuild,
    protocol: terrainPositionProtocol,
  };
  const { catalog } = await openChampionModelCatalog(
    catalogPath,
    catalogSha256,
    identity,
    undefined,
    { requireArchive: true },
  );
  assert.equal(catalog.selectionKind, "archive");
  assert.ok(Object.keys(catalog.assets).length > 0, "Skin catalog is empty");
  const skins = {};
  for (const [name, asset] of Object.entries(catalog.assets))
    skins[name] = await compileSkin(installation, name, asset);
  return {
    schema: 1,
    kind: "exact-native-terrain-champion-effect-resources",
    ...identity,
    catalogSha256,
    skins,
  };
}

if (import.meta.main) {
  const [installation, catalogPath, catalogSha256, output, ...extra] =
    process.argv.slice(2);
  assert.ok(
    installation && catalogPath && catalogSha256 && extra.length === 0,
    "Usage: bun native-terrain-champion-effect-resources.mjs <installation> <catalog.json> <sha256> [new receipt.json]",
  );
  const receipt = await compileChampionEffectResources({
    installation,
    catalogPath,
    catalogSha256,
  });
  const json = `${JSON.stringify(receipt, null, 2)}\n`;
  if (output === undefined) process.stdout.write(json);
  else await writeFile(output, json, { flag: "wx" });
}
