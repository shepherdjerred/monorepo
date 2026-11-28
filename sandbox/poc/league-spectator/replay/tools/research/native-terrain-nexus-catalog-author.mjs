import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { championArchiveExecutableHashes } from "./native-terrain-champion-model-catalog.mjs";
import {
  currentTerrainPositionBuild,
  terrainPositionProtocol,
} from "./native-terrain-byte-codecs.mjs";
import {
  currentNexusArchiveModels,
  currentNexusPlaceablesSha256,
  currentNexusRegistrationSha256,
} from "./native-terrain-nexus-assets.mjs";
import { currentTurretPlacementJsonSha256 } from "./native-terrain-turret-assets.mjs";
import { turretPlacementReceiptDigests } from "./native-terrain-turrets.mjs";

const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Project build-authored model bindings and placements after verifying the supplied manifest. */
export function projectCurrentNexusCatalog(
  catalog,
  assetIds,
  placementReceipt,
) {
  const { build, protocol, registration, placeables } = catalog;
  assert.equal(catalog.schema, 1);
  assert.equal(catalog.kind, "exact-native-terrain-nexus-catalog");
  assert.deepEqual(Object.keys(catalog).sort(), [
    "assets",
    "build",
    "installedExeSha256",
    "kind",
    "map",
    "placeables",
    "placementReceiptSha256",
    "protocol",
    "registration",
    "schema",
    "toolchain",
  ]);
  assert.equal(build, currentTerrainPositionBuild);
  assert.equal(protocol, terrainPositionProtocol);
  assert.equal(
    catalog.installedExeSha256,
    championArchiveExecutableHashes[build],
  );
  assert.equal(
    catalog.placementReceiptSha256,
    turretPlacementReceiptDigests[build],
  );
  assert.equal(
    digest(placementReceipt),
    currentTurretPlacementJsonSha256,
    "Authored Nexus placement receipt differs",
  );
  assert.equal(
    digest(registration),
    currentNexusRegistrationSha256,
    "Authored Nexus registration differs",
  );
  assert.equal(
    digest(placeables),
    currentNexusPlaceablesSha256,
    "Authored Nexus placeables differ",
  );
  assert.deepEqual(catalog.map, {
    archive: "DATA/FINAL/Maps/Shipping/Map11.wad.client",
    entryPath: placementReceipt.entryPath,
    archivedMapSha256: placementReceipt.archivedSha256,
    installedMapSha256: placementReceipt.installedSha256,
  });
  assert.deepEqual(Object.keys(catalog.assets).sort(), ["nexus-0", "nexus-3"]);
  assert.equal(assetIds.size, 2);
  const models = Object.entries(currentNexusArchiveModels).map(
    ([key, { skinId, bytes, sha256, skinScale, hiddenRanges }], index) => {
      const asset = catalog.assets[key];
      assert.equal(asset.skinId, skinId);
      assert.deepEqual(asset.model, {
        file: `${key}/model.glb`,
        bytes,
        sha256,
      });
      assert.equal(asset.skinScale ?? 1, skinScale);
      assert.deepEqual(asset.hiddenRanges, hiddenRanges);
      const participantId = assetIds.get(key);
      assert.equal(
        participantId,
        100 + index,
        "Unexpected authored Nexus model binding ID",
      );
      return [key, participantId];
    },
  );
  return {
    build,
    protocol,
    placementReceipt,
    registration,
    placeables,
    models,
  };
}
