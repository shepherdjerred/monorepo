import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { championArchiveExecutableHashes } from "./native-terrain-champion-model-catalog.mjs";
import {
  currentTerrainPositionBuild,
  terrainPositionProtocol,
} from "./native-terrain-byte-codecs.mjs";
import {
  currentInhibitorArchiveModels,
  currentInhibitorRegistrationSha256,
} from "./native-terrain-inhibitor-assets.mjs";
import { turretPlacementReceiptDigests } from "./native-terrain-turrets.mjs";

const installedMapDigest =
  "ed38cba7aaa4390e8b2a2cfe778d5f1151152b9b97f2c90883c17b27b510d67a";

/** Project only build-authored placements and the caller's verified model bindings. */
export function projectCurrentInhibitorCatalog(catalog, assetIds, receipt) {
  assert.equal(catalog.schema, 1);
  assert.equal(catalog.kind, "exact-native-terrain-inhibitor-catalog");
  assert.equal(catalog.build, currentTerrainPositionBuild);
  assert.equal(catalog.protocol, terrainPositionProtocol);
  assert.equal(
    catalog.installedExeSha256,
    championArchiveExecutableHashes[catalog.build],
  );
  assert.equal(
    catalog.placementReceiptSha256,
    turretPlacementReceiptDigests[catalog.build],
  );
  assert.equal(
    receipt.entryPath,
    "data/maps/mapgeometry/map11/base_srx.materials.bin",
  );
  assert.equal(receipt.installedSha256, installedMapDigest);
  assert.equal(catalog.installedMapSha256, receipt.installedSha256);
  assert.deepEqual(Object.keys(catalog).sort(), [
    "assets",
    "build",
    "installedExeSha256",
    "installedMapSha256",
    "kind",
    "placementReceiptSha256",
    "protocol",
    "registration",
    "schema",
    "toolchain",
  ]);

  const { build, protocol, registration } = catalog;
  assert.equal(registration.length, 38);
  assert.equal(
    createHash("sha256").update(JSON.stringify(registration)).digest("hex"),
    currentInhibitorRegistrationSha256,
    "Authored inhibitor registration differs from the installed Map11 proof",
  );
  assert.deepEqual(Object.keys(catalog.assets).sort(), [
    "inhibitor-0",
    "inhibitor-3",
  ]);
  const models = Object.entries(currentInhibitorArchiveModels);
  assert.equal(assetIds.size, models.length);
  const bindings = models.map(([selector, { skinId, bytes, sha256 }]) => {
    const key = `inhibitor-${skinId}`;
    const asset = catalog.assets[key];
    assert.deepEqual(asset.model, { file: `${key}/model.glb`, bytes, sha256 });
    assert.equal(asset.skinId, skinId);
    assert.equal(asset.skinScale, null);
    assert.deepEqual(asset.hiddenRanges, ["Destroyed"]);
    const participantId = assetIds.get(key);
    assert.ok(Number.isSafeInteger(participantId) && participantId > 0);
    return [selector, participantId];
  });
  assert.notEqual(
    bindings[0][1],
    bindings[1][1],
    "Inhibitor model IDs must be unique",
  );
  return { build, protocol, registration, models: bindings };
}
