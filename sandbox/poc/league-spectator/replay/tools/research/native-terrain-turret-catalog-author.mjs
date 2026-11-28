import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { championArchiveExecutableHashes } from "./native-terrain-champion-model-catalog.mjs";
import {
  currentTerrainPositionBuild,
  terrainPositionProtocol,
} from "./native-terrain-byte-codecs.mjs";
import {
  currentTurretArchiveModels,
  currentTurretPlaceablesSha256,
  currentTurretPlacementJsonSha256,
} from "./native-terrain-turret-assets.mjs";
import { turretPlacementReceiptDigests } from "./native-terrain-turrets.mjs";

const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Project only verified build-authored inputs. The caller still verifies actual GLB bytes. */
export function projectCurrentTurretCatalog(
  catalog,
  assetIds,
  placementReceipt,
) {
  const { build, protocol, placeables } = catalog;
  assert.equal(catalog.schema, 1);
  assert.equal(catalog.kind, "exact-native-terrain-turret-catalog");
  assert.deepEqual(Object.keys(catalog).sort(), [
    "assets",
    "build",
    "installedExeSha256",
    "installedMaterials",
    "kind",
    "placeables",
    "placementReceiptSha256",
    "protocol",
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
    "Authored turret placement receipt differs",
  );
  assert.equal(
    digest(placeables),
    currentTurretPlaceablesSha256,
    "Authored turret placeables differ",
  );
  assert.equal(
    catalog.installedMaterials.sha256,
    placementReceipt.installedSha256,
  );
  assert.equal(catalog.installedMaterials.file, placementReceipt.entryPath);
  assert.deepEqual(Object.keys(catalog.assets).sort(), [
    "turret-0",
    "turret-3",
  ]);
  assert.equal(assetIds.size, 2);
  const models = Object.entries(currentTurretArchiveModels).map(
    ([asset, { skinId, bytes, sha256, skinScale, hiddenRanges }], index) => {
      const key = `turret-${skinId}`;
      const row = catalog.assets[key];
      assert.equal(row.skinId, skinId);
      assert.deepEqual(row.model, { file: `${key}/model.glb`, bytes, sha256 });
      assert.equal(row.skinScale ?? 1, skinScale);
      assert.deepEqual(row.hiddenRanges, hiddenRanges);
      const participantId = assetIds.get(key);
      assert.equal(
        participantId,
        index,
        "Unexpected authored turret model binding ID",
      );
      return [asset, participantId];
    },
  );
  return { build, protocol, placementReceipt, placeables, models };
}
