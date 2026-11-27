import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { terrainPositionProtocol } from "./native-terrain-byte-codecs.mjs";
import { readSelectedChampionAsset } from "./native-terrain-champion-opening.mjs";

export {
  corroborateChampionModelSelections,
  readChampionModelSelections,
} from "./native-terrain-champion-opening.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const digestPattern = /^[a-f0-9]{64}$/;
export const archivedChampionBuild = "16.23.840.6595";
export const currentChampionBuild = "16.23.841.8428";
export const championArchiveExecutableHashes = Object.freeze({
  [archivedChampionBuild]:
    "89d73a9e6d886c291f5b3cf42904e5e8b014148b56490d2b6c862ea96cc9f156",
  [currentChampionBuild]:
    "f0fd2b02e3bb69d4573629c0daca863cc010556a1dbdd28ef3ef24ef10b9b733",
});

export function verifyNativeCatalogOpening(opening, selections, replaySha256) {
  assert.ok(
    opening && Array.isArray(opening.rows),
    "Native opening roster required",
  );
  assert.equal(
    opening.replaySha256,
    replaySha256,
    "Native roster belongs to another replay",
  );
  assert.match(replaySha256, digestPattern);
  assert.match(opening.nativeLogSha256, digestPattern);
  assert.match(opening.proofSha256, digestPattern);
  assert.equal(opening.rows.length, 10);
  assert.equal(selections.length, opening.rows.length);
  const rowsByContext = new Map(opening.rows.map((row) => [row.context, row]));
  assert.equal(rowsByContext.size, opening.rows.length);
  for (const { context, champion, skinId } of selections) {
    const row = rowsByContext.get(context);
    assert.ok(
      Number.isSafeInteger(context) && context > 0 && context <= 0xffffffff,
    );
    assert.match(champion, /^[a-z0-9_]+$/i);
    assert.ok(Number.isSafeInteger(skinId) && skinId >= 0 && skinId <= 10000);
    assert.ok(
      row && row.champion === champion && row.skinId === skinId,
      "Opening selection disagrees with the native roster",
    );
    rowsByContext.delete(context);
  }
}

async function readCatalogFile(root, file, maxBytes) {
  const target = join(root, file);
  const stat = await lstat(target);
  assert.ok(
    stat.isFile() && (await realpath(target)) === target,
    "Champion catalog requires exact regular files",
  );
  if (maxBytes !== undefined)
    assert.ok(
      stat.size <= maxBytes,
      "Champion catalog file exceeds its audit size bound",
    );
  return await readFile(target);
}

export async function openChampionModelCatalog(
  manifestPath,
  expectedSha256,
  identity,
  selections,
  { maxManifestBytes, maxModelBytes, requireArchive = false } = {},
) {
  assert.match(expectedSha256, digestPattern);
  const root = await realpath(dirname(manifestPath));
  const manifestBytes = await readCatalogFile(
    root,
    basename(manifestPath),
    maxManifestBytes,
  );
  assert.equal(
    sha256(manifestBytes),
    expectedSha256,
    "Champion catalog digest differs",
  );
  const catalog = JSON.parse(manifestBytes.toString("utf8"));
  assert.equal(catalog.schema, 1);
  assert.equal(catalog.kind, "exact-native-terrain-champion-catalog");
  assert.equal(catalog.build, identity.build, "Champion catalog build differs");
  assert.equal(
    catalog.protocol,
    identity.protocol,
    "Champion catalog protocol differs",
  );
  assert.ok(!Object.hasOwn(catalog, "replaySha256"));
  const buildScoped =
    identity.build === currentChampionBuild &&
    catalog.selectionKind === "archive";
  assert.ok(
    !requireArchive ||
      (buildScoped && identity.protocol === terrainPositionProtocol),
    "Champion model index requires the exact current build-scoped archive catalog",
  );
  assert.ok(
    catalog.selectionKind === undefined || buildScoped,
    "Unknown champion catalog selection kind",
  );
  if (identity.build === currentChampionBuild) {
    assert.equal(
      catalog.installedExeSha256,
      championArchiveExecutableHashes[currentChampionBuild],
    );
    assert.match(catalog.sourceCensusSha256, digestPattern);
    if (buildScoped) {
      assert.equal(
        catalog.nativeOpening,
        undefined,
        "Build-scoped champion catalog cannot contain a match opening",
      );
      assert.match(catalog.sourceManifestSha256, digestPattern);
      assert.match(catalog.selectionSha256, digestPattern);
    } else {
      verifyNativeCatalogOpening(
        catalog.nativeOpening,
        selections,
        identity.replaySha256,
      );
    }
  }
  assert.ok(
    catalog.assets &&
      !Array.isArray(catalog.assets) &&
      typeof catalog.assets === "object",
  );
  async function readModel({ context, champion, skinId }) {
    const key = `${champion.toLowerCase()}-${skinId}`;
    const asset = readSelectedChampionAsset(catalog, { champion, skinId });
    const { skinScale, hiddenRanges, model } = asset;
    assert.ok(
      skinScale === null || (Number.isFinite(skinScale) && skinScale > 0),
    );
    assert.ok(
      Array.isArray(hiddenRanges) &&
        hiddenRanges.every(
          (name) => typeof name === "string" && name.length > 0,
        ),
    );
    assert.equal(new Set(hiddenRanges).size, hiddenRanges.length);
    assert.equal(model.file, `${key}/model.glb`);
    assert.match(model.sha256, digestPattern);
    const bytes = await readCatalogFile(root, model.file, maxModelBytes);
    assert.equal(bytes.byteLength, model.bytes);
    assert.equal(sha256(bytes), model.sha256, "Champion model digest differs");
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "glTF");
    assert.equal(bytes.readUInt32LE(4), 2);
    assert.equal(bytes.readUInt32LE(8), bytes.byteLength);
    const url = `/champion-models/${model.sha256}.glb`;
    return {
      bytes,
      binding: {
        participantId: context,
        skinId,
        skinScale: skinScale ?? 1,
        hiddenRanges,
        url,
      },
    };
  }
  return { catalog, readModel };
}

export async function loadChampionModelCatalog(
  manifestPath,
  expectedSha256,
  identity,
  selections,
) {
  const { readModel } = await openChampionModelCatalog(
    manifestPath,
    expectedSha256,
    identity,
    selections,
  );
  const routes = new Map();
  const bindings = [];
  for (const selection of selections) {
    const { bytes, binding } = await readModel(selection);
    routes.set(binding.url, [bytes, "model/gltf-binary"]);
    bindings.push(binding);
  }
  return { bindings, routes };
}

/** Project all authenticated archive entries into the browser-safe model index. */
export async function loadChampionModelCatalogIndex(
  manifestPath,
  expectedSha256,
  identity,
) {
  const { catalog, readModel } = await openChampionModelCatalog(
    manifestPath,
    expectedSha256,
    identity,
    undefined,
    { requireArchive: true },
  );
  const assets = {};
  const routes = new Map();
  const entries = Object.entries(catalog.assets);
  assert.ok(entries.length > 0, "Champion model index is empty");
  for (const [key, asset] of entries) {
    const { champion, skinId, skinScale, hiddenRanges, model } = asset;
    assert.match(champion, /^[a-z0-9_]+$/i);
    assert.equal(
      key,
      `${champion.toLowerCase()}-${skinId}`,
      "Champion archive model key differs",
    );
    assert.match(asset.archiveIndexSha256, digestPattern);
    const { bytes, binding } = await readModel({ champion, skinId });
    routes.set(binding.url, [bytes, "model/gltf-binary"]);
    assets[key] = {
      champion,
      skinId,
      skinScale,
      hiddenRanges,
      model: { file: model.file, sha256: model.sha256, bytes: model.bytes },
    };
  }
  const { schema, kind, build, protocol, selectionKind } = catalog;
  return {
    championModelCatalog: {
      schema,
      kind,
      build,
      protocol,
      selectionKind,
      assets,
    },
    routes,
  };
}
