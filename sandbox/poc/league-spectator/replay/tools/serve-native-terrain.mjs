import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { zstdDecompressSync } from "node:zlib";
import { readReplayActorLevels } from "../../../../../packages/scout-for-lol/packages/replay/src/observations/replay-actor-levels.mjs";
import { prepareReplayForSeek } from "../../../../../packages/scout-for-lol/packages/replay/src/prepare.ts";
import { replayTimedPacketEnvelopes } from "../replay-packet-clock.mjs";
import { movementWorldPaths } from "../movement-records.mjs";
import { openReplay, replayPacketEnvelopes } from "../transport.mjs";
import { buildMotionWorker } from "./build-native-terrain-motion-worker.mjs";
import { readExactClassicCameraDefaults } from "./exact-map-bin.mjs";
import {
  bindNativeSceneParticipants,
  createNativePositionSceneTrace,
} from "./research/native-position-scene.mjs";
import { createNavgridGroundHeight } from "./research/native-terrain-ground.mjs";
import { currentTerrainPositionBuild } from "./research/native-terrain-byte-codecs.mjs";
import { bindNativeTerrainChampionIdentities } from "./research/native-terrain-champion-identities.mjs";
import {
  loadChampionModelCatalog,
  loadChampionModelCatalogIndex,
  readChampionModelSelections,
} from "./research/native-terrain-champion-model-catalog.mjs";
import { prepareCurrentChampionModelBindings } from "./research/native-terrain-champion-opening.mjs";
import {
  projectRecordedPlayerState,
  readCurrentRecordedPlayerState,
} from "./research/native-terrain-player-state.mjs";
import { validateRecordedTerrainVisibility } from "./research/recorded-terrain-visibility.mjs";

// Reviewed initial-visibility export of the installed 16.23.840.6595 Map11.
const terrainExportBuild = "16.23.840.6595";
const localDigests = {
  "map.mapgeo":
    "d6d8d434b977ee43bbc05aeb61d586476c692585da9cf7b2971906091539d1a5",
  "map/map.json":
    "24716f3c47ed5eadaa80693f0113dffb21dd2b5ab419957c5ae91c3a0e77ad15",
  "map/map.bin":
    "a574779dd23f225a62a08e3fc87554aea55c3e1f1e72e63ef90a5c502b77105f",
  "projection-proof.json":
    "2d958eb226c0ecf3875d9540bd04545f3953854f50a7f729c410a428db71e3c6",
  "heights.bin":
    "26f048f2df55f4c9e583c9fb1c4fe2aa935d9cf4669020bebee19eb3f9ce372e",
  "topography.png":
    "dbe65ebe8ef8133e82400b632cc7be62d24fe2ffe77f33bc86bc1a221afbeadd",
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "position-decoder": { type: "string" },
    "scout-recovery-db": { type: "string" },
    "canonical-match": { type: "string" },
    "canonical-match-sha256": { type: "string" },
    "rift-startup-archive": { type: "string" },
    "private-package-output": { type: "string" },
    "announcer-preview": { type: "string" },
    "announcer-catalog": { type: "string" },
    "recorded-particles": { type: "string" },
    "recorded-particles-sha256": { type: "string" },
    "worker-decompressor": { type: "string" },
    "camera-globals": { type: "string" },
    "terrain-materials": { type: "string" },
    "terrain-visibility": { type: "string" },
    "terrain-visibility-sha256": { type: "string" },
    "terrain-visibility-from-replay": { type: "string" },
    "infernal-terrain-export": { type: "string" },
    "mountain-terrain-export": { type: "string" },
    "champion-models": { type: "string" },
    "champion-catalog-sha256": { type: "string" },
    "champion-models-from-replay": { type: "boolean" },
    "champion-animation-cues": { type: "string" },
    "champion-animation-cues-sha256": { type: "string" },
    "champion-animation-catalog": { type: "string" },
    "champion-animation-catalog-sha256": { type: "string" },
    "champion-health": { type: "string" },
    "champion-health-sha256": { type: "string" },
    "champion-resources": { type: "string" },
    "champion-resources-sha256": { type: "string" },
    "champion-stats-from-replay": { type: "boolean" },
    "player-state-from-replay": { type: "boolean" },
    "champion-experience": { type: "string" },
    "champion-experience-sha256": { type: "string" },
    "champion-experience-from-replay": { type: "boolean" },
    "experience-map-definition": { type: "string" },
    "champion-inventory": { type: "string" },
    "champion-inventory-sha256": { type: "string" },
    "champion-inventory-from-replay": { type: "boolean" },
    "item-assets": { type: "string" },
    "item-assets-sha256": { type: "string" },
    "structure-models": { type: "string" },
    "authored-turret-catalog": { type: "string" },
    "authored-turret-catalog-sha256": { type: "string" },
    "turrets-from-replay": { type: "boolean" },
    "chaos-turret-collapse": { type: "string" },
    "nexus-models": { type: "string" },
    "authored-nexus-catalog": { type: "string" },
    "authored-nexus-catalog-sha256": { type: "string" },
    "nexus-from-replay": { type: "boolean" },
    "inhibitor-models": { type: "string" },
    "inhibitor-models-sha256": { type: "string" },
    "authored-inhibitor-catalog": { type: "string" },
    "authored-inhibitor-catalog-sha256": { type: "string" },
    "inhibitors-from-replay": { type: "boolean" },
    "world-unit-models": { type: "string" },
    "world-unit-models-sha256": { type: "string" },
    "neutral-unit-models": { type: "string" },
    "neutral-unit-models-sha256": { type: "string" },
    "neutral-model-catalog": { type: "string" },
    "neutral-model-catalog-sha256": { type: "string" },
    "neutral-camp-model-catalog": { type: "string" },
    "neutral-camp-model-catalog-sha256": { type: "string" },
    "lane-minion-models": { type: "string" },
    "lane-minion-models-sha256": { type: "string" },
    "lane-minion-model-catalog": { type: "string" },
    "lane-minion-model-catalog-sha256": { type: "string" },
    "lane-minion-map-definitions": { type: "string" },
    "lane-minion-map-materials": { type: "string" },
    "team-vision": { type: "string" },
    "team-vision-sha256": { type: "string" },
    "team-vision-from-replay": { type: "boolean" },
    "scout-css": { type: "string" },
    "turret-placements": { type: "string" },
  },
  allowPositionals: true,
});
const [terrainRoot, threeCore, replayPath, ...receiptPaths] = positionals;
const rawReplayOnly = receiptPaths.length === 0;
const privatePackageOutput = values["private-package-output"];
const recoveryPath = values["scout-recovery-db"];
const canonicalMatchPath = values["canonical-match"];
const canonicalMatchDigest = values["canonical-match-sha256"];
const riftStartupArchive = values["rift-startup-archive"];
assert.ok(
  riftStartupArchive === undefined ||
    (privatePackageOutput !== undefined &&
      canonicalMatchPath === undefined &&
      recoveryPath === undefined),
  "Native Rift startup requires a private package without another provenance source",
);
assert.equal(
  canonicalMatchPath === undefined,
  canonicalMatchDigest === undefined,
  "Canonical replay evidence requires a matching SHA-256 pin",
);
assert.ok(
  canonicalMatchPath === undefined ||
    (privatePackageOutput !== undefined &&
      recoveryPath === undefined &&
      /^[a-f0-9]{64}$/u.test(canonicalMatchDigest)),
  "Canonical replay evidence requires a private package without Scout Desktop recovery",
);
const terrainVisibilityPath = values["terrain-visibility"];
const terrainVisibilityDigest = values["terrain-visibility-sha256"];
const terrainControllerMaterialsPath = values["terrain-visibility-from-replay"];
assert.ok(
  terrainVisibilityDigest === undefined ||
    (privatePackageOutput !== undefined &&
      terrainVisibilityPath !== undefined &&
      /^[a-f\d]{64}$/u.test(terrainVisibilityDigest)),
  "--terrain-visibility-sha256 requires a SHA-256 pin, --terrain-visibility, and a private package",
);
assert.ok(
  terrainControllerMaterialsPath === undefined ||
    (privatePackageOutput !== undefined &&
      terrainVisibilityPath === undefined &&
      values["terrain-materials"] !== undefined),
  "Replay-derived terrain visibility requires reviewed materials and a private package without a prepared terrain receipt",
);
assert.ok(
  recoveryPath === undefined || privatePackageOutput !== undefined,
  "Saved Scout Desktop recovery is available for private packages",
);
const cameraGlobalsPath = values["camera-globals"];
assert.ok(
  cameraGlobalsPath === undefined || privatePackageOutput !== undefined,
  "Exact CLASSIC camera configuration requires a private package",
);
const inventoryPath = values["champion-inventory"];
const inventoryDigest = values["champion-inventory-sha256"];
const decodeChampionInventory =
  values["champion-inventory-from-replay"] === true;
const itemAssetsPath = values["item-assets"];
const itemAssetsDigest = values["item-assets-sha256"];
assert.ok(
  (inventoryDigest === undefined) === (inventoryPath === undefined),
  "Prepared champion inventory requires a SHA-256 pin",
);
const includeInventory = decodeChampionInventory || inventoryPath !== undefined;
assert.ok(
  [itemAssetsPath, itemAssetsDigest].every(
    (value) => (value !== undefined) === includeInventory,
  ),
  "Recorded inventory requires a pinned item asset catalog",
);
assert.ok(
  !includeInventory || privatePackageOutput !== undefined,
  "Recorded inventory requires a private package",
);
assert.ok(
  !decodeChampionInventory || inventoryPath === undefined,
  "Replay-decoded champion inventory conflicts with prepared inventory tracks",
);
const animationPath = values["champion-animation-cues"];
const animationDigest = values["champion-animation-cues-sha256"];
const animationCatalogPath = values["champion-animation-catalog"];
const animationCatalogDigest = values["champion-animation-catalog-sha256"];
assert.equal(
  animationPath === undefined,
  animationDigest === undefined,
  "Champion animation cues require a matching SHA-256 pin",
);
assert.ok(
  animationPath === undefined || privatePackageOutput !== undefined,
  "Recorded champion animation cues require a private package",
);
assert.equal(
  animationCatalogPath === undefined,
  animationCatalogDigest === undefined,
  "Champion animation catalogs require a matching SHA-256 pin",
);
assert.ok(
  animationCatalogPath === undefined ||
    (animationPath === undefined && privatePackageOutput !== undefined),
  "Replay-decoded champion animations require a private package without prepared cues",
);
const turretCatalogPath = values["authored-turret-catalog"];
const turretCatalogDigest = values["authored-turret-catalog-sha256"];
const decodeTurrets = values["turrets-from-replay"] === true;
const chaosTurretCollapseDirectory = values["chaos-turret-collapse"];
assert.ok(
  chaosTurretCollapseDirectory === undefined ||
    (decodeTurrets && privatePackageOutput !== undefined),
  "Chaos turret collapse requires replay-derived turrets and a private package",
);
assert.equal(
  turretCatalogPath === undefined,
  turretCatalogDigest === undefined,
  "Authored turret catalogs require a matching SHA-256 pin",
);
assert.ok(
  turretCatalogPath === undefined ||
    (privatePackageOutput !== undefined &&
      values["turret-placements"] !== undefined &&
      values["structure-models"] === undefined),
  "Authored turret catalogs require a private package and turret placements without prepared structure models",
);
assert.ok(
  !decodeTurrets ||
    (turretCatalogPath !== undefined &&
      values["worker-decompressor"] !== undefined &&
      values["position-decoder"] !== undefined &&
      values["team-vision"] === undefined),
  "Replay-derived turrets require a pinned authored catalog and motion worker without prepared team vision",
);
const announcerDirectory = values["announcer-preview"];
const announcerCatalogDirectory = values["announcer-catalog"];
const inhibitorCatalogPath = values["authored-inhibitor-catalog"];
const inhibitorCatalogDigest = values["authored-inhibitor-catalog-sha256"];
const decodeInhibitors = values["inhibitors-from-replay"] === true;
const nexusCatalogPath = values["authored-nexus-catalog"];
const nexusCatalogDigest = values["authored-nexus-catalog-sha256"];
const decodeNexus = values["nexus-from-replay"] === true;
assert.equal(
  nexusCatalogPath === undefined,
  nexusCatalogDigest === undefined,
  "Authored Nexus catalogs require a matching SHA-256 pin",
);
assert.ok(
  nexusCatalogPath === undefined ||
    (privatePackageOutput !== undefined &&
      values["turret-placements"] !== undefined &&
      values["nexus-models"] === undefined),
  "Authored Nexus catalogs require a private package and turret placements without prepared Nexus models",
);
assert.ok(
  !decodeNexus ||
    (nexusCatalogPath !== undefined &&
      values["worker-decompressor"] !== undefined &&
      values["position-decoder"] !== undefined &&
      values["team-vision"] === undefined),
  "Replay-derived Nexus requires a pinned authored catalog and motion worker without prepared team vision",
);
assert.equal(
  inhibitorCatalogPath === undefined,
  inhibitorCatalogDigest === undefined,
  "Authored inhibitor catalogs require a matching SHA-256 pin",
);
assert.ok(
  inhibitorCatalogPath === undefined ||
    (privatePackageOutput !== undefined &&
      values["turret-placements"] !== undefined &&
      values["inhibitor-models"] === undefined),
  "Authored inhibitor catalogs require a private package and turret placements without prepared inhibitor models",
);
assert.ok(
  !decodeInhibitors ||
    (inhibitorCatalogPath !== undefined &&
      values["worker-decompressor"] !== undefined &&
      values["position-decoder"] !== undefined),
  "Replay-derived inhibitors require a pinned authored catalog and motion worker",
);
const championStatInputs = [
  { kind: "health", field: "championHealthTracks" },
  { kind: "resources", field: "championResourceTracks" },
  { kind: "experience", field: "championExperience" },
]
  .map((entry) => {
    const path = values[`champion-${entry.kind}`];
    const digest = values[`champion-${entry.kind}-sha256`];
    assert.equal(
      path === undefined,
      digest === undefined,
      `Champion ${entry.kind} requires a matching SHA-256 pin`,
    );
    assert.ok(
      path === undefined || privatePackageOutput !== undefined,
      `Recorded champion ${entry.kind} requires a private package`,
    );
    return { ...entry, path, digest };
  })
  .filter(({ path }) => path !== undefined);
const decodeChampionStats = values["champion-stats-from-replay"] === true;
if (decodeChampionStats) {
  assert.ok(
    privatePackageOutput !== undefined &&
      values["position-decoder"] !== undefined &&
      values["worker-decompressor"] !== undefined,
    "Replay-decoded champion stats require a private package with a motion worker",
  );
  assert.ok(
    championStatInputs.every(({ kind }) => kind === "experience"),
    "Replay-decoded champion stats conflict with prepared health or resources",
  );
}
const experienceMapPath = values["experience-map-definition"];
const decodeChampionExperience =
  values["champion-experience-from-replay"] === true;
assert.equal(
  experienceMapPath !== undefined,
  decodeChampionExperience || values["champion-experience"] !== undefined,
  "Recorded experience requires the exact Map11 definition",
);
assert.ok(
  !decodeChampionExperience ||
    (privatePackageOutput !== undefined &&
      values["champion-experience"] === undefined),
  "Replay-decoded champion experience requires a private package without prepared experience tracks",
);
const visionPath = values["team-vision"];
const visionDigest = values["team-vision-sha256"];
const decodeTeamVision = values["team-vision-from-replay"] === true;
assert.equal(
  visionPath === undefined,
  visionDigest === undefined,
  "Team vision requires a matching SHA-256 pin",
);
assert.ok(
  visionPath === undefined || privatePackageOutput !== undefined,
  "Recorded team vision requires a private package",
);
assert.ok(
  !decodeTeamVision ||
    (visionPath === undefined && privatePackageOutput !== undefined),
  "Replay-derived team vision requires a private package without prepared vision tracks",
);
assert.ok(
  announcerDirectory === undefined || privatePackageOutput !== undefined,
  "Announcer playback assets require a private package output",
);
assert.ok(
  announcerCatalogDirectory === undefined ||
    (announcerDirectory === undefined && privatePackageOutput !== undefined),
  "Replay-derived announcer audio requires a private package without prepared announcer timing",
);
const scoutScene =
  values["scout-css"] !== undefined || privatePackageOutput !== undefined;
if (privatePackageOutput !== undefined) {
  assert.ok(
    rawReplayOnly,
    "Private packages prepare scenes from the original replay",
  );
  for (const option of [
    "position-decoder",
    "worker-decompressor",
    "terrain-materials",
    "champion-models",
  ])
    assert.ok(values[option], `Private packages require --${option}`);
}
assert.ok(
  terrainRoot &&
    threeCore &&
    replayPath &&
    (!rawReplayOnly ||
      (values["position-decoder"] !== undefined && scoutScene)),
  "Usage: bun serve-native-terrain.mjs <audit-map11-static directory> <three.core.js> <replay.rofl> [<position-receipt.json> ...] [--scout-css <built css>] [--turret-placements <installed receipt>] [--position-decoder <local binary or prepared decoder>] [--worker-decompressor <prepared fzstd.mjs>] [--terrain-materials <prepared materials.json>] [--champion-models <prepared models manifest>] [--structure-models <prepared structure models manifest>] [--nexus-models <prepared nexus models manifest>]. Without a position receipt, --position-decoder and --scout-css are required.",
);
assert.ok(
  values["position-decoder"] === undefined || scoutScene,
  "The keyframe position view requires --scout-css",
);
assert.ok(
  values["worker-decompressor"] === undefined ||
    values["position-decoder"] !== undefined,
  "The browser motion worker requires a prepared --position-decoder",
);
assert.ok(
  values["terrain-materials"] === undefined || scoutScene,
  "The authored terrain view requires --scout-css",
);
assert.ok(
  values["champion-models"] === undefined ||
    values["position-decoder"] !== undefined,
  "Champion model playback requires --position-decoder",
);
assert.ok(
  values["champion-catalog-sha256"] === undefined ||
    (values["champion-models"] !== undefined &&
      privatePackageOutput !== undefined),
  "The champion catalog pin requires --champion-models and a private package output",
);
assert.ok(
  values["structure-models"] === undefined ||
    (values["turret-placements"] !== undefined && scoutScene),
  "Structure model playback requires --turret-placements and --scout-css",
);
assert.ok(
  values["nexus-models"] === undefined ||
    values["position-decoder"] !== undefined,
  "Nexus model playback requires --position-decoder",
);
assert.equal(
  values["inhibitor-models"] === undefined,
  values["inhibitor-models-sha256"] === undefined,
  "--inhibitor-models requires an explicit matching SHA-256 pin",
);
assert.ok(
  values["inhibitor-models"] === undefined ||
    (scoutScene && values["turret-placements"] !== undefined),
  "--inhibitor-models requires a Scout scene and --turret-placements",
);
for (const option of [
  "world-unit-models",
  "neutral-unit-models",
  "lane-minion-models",
]) {
  assert.equal(
    values[option] === undefined,
    values[`${option}-sha256`] === undefined,
    `--${option} requires an explicit matching SHA-256 pin`,
  );
  assert.ok(
    values[option] === undefined ||
      (scoutScene && values["position-decoder"] !== undefined),
    `--${option} requires a Scout scene and its position decoder`,
  );
}

const neutralModelCatalogPath = values["neutral-model-catalog"];
const neutralCampCatalogPath = values["neutral-camp-model-catalog"];
assert.equal(
  neutralCampCatalogPath === undefined,
  values["neutral-camp-model-catalog-sha256"] === undefined,
  "--neutral-camp-model-catalog requires an explicit matching SHA-256 pin",
);
assert.ok(
  neutralCampCatalogPath === undefined || neutralModelCatalogPath !== undefined,
  "--neutral-camp-model-catalog requires --neutral-model-catalog",
);
assert.equal(
  neutralModelCatalogPath === undefined,
  values["neutral-model-catalog-sha256"] === undefined,
  "--neutral-model-catalog requires an explicit matching SHA-256 pin",
);
assert.ok(
  neutralModelCatalogPath === undefined ||
    (privatePackageOutput !== undefined &&
      values["position-decoder"] !== undefined &&
      values["neutral-unit-models"] === undefined &&
      values["world-unit-models"] === undefined &&
      visionPath === undefined),
  "Replay-derived neutral objectives require a private worker package without prepared neutral models or prepared team vision",
);

const laneMinionCatalogPath = values["lane-minion-model-catalog"];
for (const option of [
  "lane-minion-model-catalog-sha256",
  "lane-minion-map-definitions",
  "lane-minion-map-materials",
]) {
  assert.equal(
    laneMinionCatalogPath === undefined,
    values[option] === undefined,
    `--lane-minion-model-catalog requires --${option}`,
  );
}
assert.ok(
  laneMinionCatalogPath === undefined ||
    (privatePackageOutput !== undefined &&
      values["position-decoder"] !== undefined &&
      values["lane-minion-models"] === undefined &&
      visionPath === undefined),
  "Replay-derived lane minions require a private worker package without prepared lane models or prepared team vision",
);

async function readPinned(path) {
  const bytes = await readFile(join(terrainRoot, path));
  assert.equal(
    sha256(bytes),
    localDigests[path],
    `Local Map11 digest mismatch: ${path}`,
  );
  return bytes;
}

async function loadTerrainMaterials(manifestPath, meshes, proof, assetDigests) {
  const manifestBytes = await readFile(manifestPath);
  assert.ok(
    [
      "b621b18ba10f4979f50acf562cf5e42a8c750caf6e31060fc55a31a07b7112e1",
      "ac8454d98df0416515f0ac4618050af121668ee00e1511c8ed866daf6f02518b",
      "c4ccce86cabfe3f8c47e39eb60588c35ff605c75dd118d0fd898f99f9eea1340",
      "12a412d96d08f7fec511f3a6547d3fb8f0dbd2fe1673592ff8567e1e0895d6fc",
    ].includes(sha256(manifestBytes)),
    "Terrain materials do not match the pinned preview export",
  );
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.schema, 1);
  assert.equal(manifest.build, terrainExportBuild);
  assert.equal(manifest.protocol, proof.protocol);
  assert.deepEqual(manifest.source, {
    wadSha256:
      "b1e05a8b46185f5a597f1aa0a0466b4fefbe6ae1aa1711a9c61a145d4a8f94cd",
    geometrySha256: localDigests["map.mapgeo"],
    materialsSha256:
      "ed38cba7aaa4390e8b2a2cfe778d5f1151152b9b97f2c90883c17b27b510d67a",
    mapMetadataSha256: assetDigests["map/map.json"],
    mapMeshSha256: assetDigests["map/map.bin"],
  });
  const mountainMeshes = meshes.filter(({ flags }) => flags === 4);
  if (mountainMeshes.length > 0) {
    const source = manifest.mountainSource;
    assert.equal(source?.build, "16.23.841.8428");
    assert.equal(
      source.wadSha256,
      "61a9f97a360ab80853f8fc8fb13c4891433c1b74f8d7217f5fc34addb2414a07",
    );
    assert.equal(
      source.baseManifestSha256,
      "b621b18ba10f4979f50acf562cf5e42a8c750caf6e31060fc55a31a07b7112e1",
    );
    assert.equal(source.geometrySha256, manifest.source.geometrySha256);
    assert.equal(source.materialsSha256, manifest.source.materialsSha256);
    const replacements = new Set(
      mountainMeshes.flatMap(({ submeshes }) =>
        submeshes.map(({ material }) => material),
      ),
    );
    assert.equal(replacements.size, 12);
    assert.equal(Object.keys(source.textures).length, replacements.size);
    for (const material of replacements)
      assert.ok(
        Object.hasOwn(source.textures, material) &&
          Object.hasOwn(manifest.bindings, material),
        "Mountain replacements require their original texture bindings",
      );
  }
  const used = new Set();
  let texturedTriangles = 0;
  for (const mesh of meshes) {
    for (const part of mesh.submeshes) {
      used.add(part.material);
      if (Object.hasOwn(manifest.bindings, part.material)) {
        assert.equal(mesh.hasUv, true);
        texturedTriangles += part.count / 3;
      } else assert.ok(Object.hasOwn(manifest.unsupported, part.material));
    }
  }
  const materialRoutes = new Map();
  const bindings = [];
  for (const [material, binding] of Object.entries(manifest.bindings)) {
    const {
      sha256: digest,
      bytes,
      alphaTest,
      width,
      height,
      sourceAlphaBlend,
    } = binding;
    assert.ok(used.has(material) && /^[a-f0-9]{64}$/.test(digest));
    assert.equal(binding.path, `textures/${digest}.png`);
    assert.ok(Number.isFinite(alphaTest) && alphaTest >= 0 && alphaTest <= 1);
    assert.ok(
      sourceAlphaBlend === undefined ||
        (sourceAlphaBlend === true && alphaTest === 0),
    );
    assert.ok(
      [width, height].every(
        (size) => Number.isSafeInteger(size) && size > 0 && size <= 512,
      ),
    );
    const url = `/map-textures/${digest}.png`;
    if (!materialRoutes.has(url)) {
      const texture = await readFile(join(dirname(manifestPath), binding.path));
      assert.equal(sha256(texture), digest, "Terrain texture digest differs");
      assert.equal(texture.readUInt32BE(16), width);
      assert.equal(texture.readUInt32BE(20), height);
      materialRoutes.set(url, [texture, "image/png"]);
    }
    assert.equal(materialRoutes.get(url)[0].byteLength, bytes);
    bindings.push({
      material,
      url,
      alphaTest,
      width,
      height,
      ...(sourceAlphaBlend === true ? { sourceAlphaBlend } : {}),
    });
  }
  assert.deepEqual(manifest.coverage, {
    totalTriangles: proof.staticMesh.meshTriangles,
    texturedTriangles,
    unsupportedTriangles: proof.staticMesh.meshTriangles - texturedTriangles,
    materials: used.size,
    texturedMaterials: bindings.length,
    textures: materialRoutes.size,
  });
  return { bindings, texturedTriangles, routes: materialRoutes };
}

async function loadLegacyChampionModelRoutes(
  manifestPath,
  identity,
  observations,
) {
  const exported = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(exported.schema, 1);
  assert.equal(exported.kind, "exact-native-terrain-models");
  for (const field of ["build", "protocol", "replaySha256"])
    assert.equal(
      exported[field],
      identity[field],
      `Champion model ${field} mismatch`,
    );
  const openingAssets = {
    cea604f9944cb8ca433a0655d742e0b741ae4477e0c7100b59a25b3221562668:
      "da203185f0fd46424a86987158f0a5e0f463dd661f91197a2ecfd053bfcbd356",
    d7cabb0b7ba965f317863d128238847a0b9b0e4cc0cdbcfa3077c537b10fdf2b:
      "c042e86c64352e517d946055d7fc1753a4d0f54205af64875a4f1734d8af02a0",
  };
  assert.ok(Object.hasOwn(openingAssets, identity.replaySha256));
  assert.equal(
    exported.sourceManifestSha256,
    openingAssets[identity.replaySha256],
    "Champion models do not derive from the reviewed opening skin selections",
  );
  const footerRows = new Map(
    observations.binding.verified.map(({ footerRow, context }) => [
      footerRow,
      context,
    ]),
  );
  assert.equal(exported.actors.length, identity.participantCount);
  assert.equal(footerRows.size, identity.participantCount);
  const routes = new Map();
  const seen = new Set();
  const bindings = await Promise.all(
    exported.actors.map(async (actor) => {
      const {
        context,
        footerRow,
        champion,
        skinId,
        skinScale,
        hiddenRanges,
        model,
      } = actor;
      assert.ok(footerRows.has(footerRow) && !seen.has(footerRow));
      seen.add(footerRow);
      assert.equal(context, footerRows.get(footerRow));
      assert.equal(champion, observations.roster[footerRow - 1].champion);
      assert.ok(
        /^[a-z0-9_]+$/i.test(champion) &&
          Number.isSafeInteger(skinId) &&
          skinId >= 0,
      );
      assert.ok(
        skinScale === null || (Number.isFinite(skinScale) && skinScale > 0),
      );
      assert.ok(
        Array.isArray(hiddenRanges) &&
          hiddenRanges.every(
            (range) => typeof range === "string" && range.length > 0,
          ),
      );
      assert.equal(new Set(hiddenRanges).size, hiddenRanges.length);
      assert.ok(model, `Model preparation is incomplete for ${champion}`);
      assert.equal(model.file, `${champion.toLowerCase()}-${skinId}/model.glb`);
      const url = await addModelRoute(
        routes,
        manifestPath,
        model,
        "champion-models",
      );
      return {
        participantId: context,
        skinId,
        skinScale: skinScale ?? 1,
        hiddenRanges,
        url,
      };
    }),
  );
  return { bindings, routes };
}

async function addModelRoute(routes, manifestPath, model, directory) {
  assert.match(model.sha256, /^[a-f0-9]{64}$/);
  const bytes = await readFile(join(dirname(manifestPath), model.file));
  assert.equal(bytes.byteLength, model.bytes);
  assert.equal(sha256(bytes), model.sha256, "Model digest differs");
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "glTF");
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.byteLength);
  const url = `/${directory}/${model.sha256}.glb`;
  routes.set(url, [bytes, "model/gltf-binary"]);
  return url;
}

async function loadWorldModelBindings(
  manifestPath,
  assets,
  directory,
  firstId,
) {
  const routes = new Map();
  const assetIds = new Map();
  const bindings = await Promise.all(
    Object.entries(assets).map(async ([assetId, asset], index) => {
      assert.match(assetId, /^[a-z0-9_-]+$/i);
      const participantId = firstId + index;
      assetIds.set(assetId, participantId);
      assert.equal(asset.model.file, `${assetId}/model.glb`);
      const skinScale = asset.skinScale ?? 1;
      assert.ok(Number.isFinite(skinScale) && skinScale > 0);
      const { hiddenRanges } = asset;
      assert.ok(
        Array.isArray(hiddenRanges) &&
          hiddenRanges.every((name) => typeof name === "string" && name.length),
      );
      assert.equal(new Set(hiddenRanges).size, hiddenRanges.length);
      const url = await addModelRoute(
        routes,
        manifestPath,
        asset.model,
        directory,
      );
      return { participantId, skinScale, hiddenRanges, url };
    }),
  );
  return { bindings, assetIds, routes };
}

async function readPinnedWorldUnitManifest(manifestPath, digest) {
  assert.match(digest, /^[a-f0-9]{64}$/);
  const source = await readFile(manifestPath);
  assert.equal(
    sha256(source),
    digest,
    "World unit manifest digest differs from its pin",
  );
  const manifest = JSON.parse(source);
  assert.equal(manifest.schema, 1);
  return manifest;
}

function assertWorldUnitReplay(proof, identity, decoderBytes) {
  for (const field of ["build", "protocol", "replaySha256"])
    assert.equal(proof[field], identity[field], `World unit ${field} mismatch`);
  assert.equal(proof.decoderSha256, sha256(decoderBytes));
}

async function loadWorldUnitAssets(manifestPath, assets, firstId) {
  const routes = new Map();
  const bindings = [];
  const models = new Map();
  for (const { modelId, model, skinScale, hiddenRanges } of assets) {
    assert.match(modelId, /^[a-z0-9_-]+$/);
    assert.ok(!models.has(modelId), "Duplicate world unit model");
    assert.match(model.file, /^[a-z0-9_-]+\/model\.glb$/);
    assert.ok(Number.isFinite(skinScale) && skinScale > 0);
    assert.ok(
      Array.isArray(hiddenRanges) &&
        hiddenRanges.every(
          (name) => typeof name === "string" && name.length > 0,
        ),
    );
    assert.equal(new Set(hiddenRanges).size, hiddenRanges.length);
    const participantId = firstId + models.size;
    models.set(modelId, participantId);
    const url = await addModelRoute(
      routes,
      manifestPath,
      model,
      "world-unit-models",
    );
    bindings.push({ participantId, skinScale, hiddenRanges, url });
  }
  return { routes, bindings, models };
}

async function loadWorldUnitModelRoutes(
  manifestPath,
  digest,
  identity,
  decoderBytes,
  proof,
  kills,
  firstId = 200,
  recordedActors,
) {
  const manifest = await readPinnedWorldUnitManifest(manifestPath, digest);
  assertWorldUnitReplay(manifest, identity, decoderBytes);
  if (recordedActors !== undefined)
    assert.deepEqual(
      manifest.actors,
      recordedActors,
      "Neutral unit actors differ from the original replay observations",
    );
  const { routes, bindings, models } = await loadWorldUnitAssets(
    manifestPath,
    manifest.models,
    firstId,
  );
  const instances = [];
  const contexts = new Set();
  const usedModels = new Set();
  const { min, max } = proof.mapBounds;
  for (const {
    context,
    modelId,
    creationTimeSeconds,
    killTimeSeconds,
    observations,
  } of manifest.actors) {
    const participantId = models.get(modelId);
    assert.ok(participantId !== undefined);
    usedModels.add(participantId);
    assert.ok(
      Number.isSafeInteger(context) && context > 0 && !contexts.has(context),
    );
    contexts.add(context);
    assert.ok(
      Number.isFinite(creationTimeSeconds) &&
        creationTimeSeconds >= 0 &&
        creationTimeSeconds < killTimeSeconds,
    );
    assert.ok(
      kills.some(
        (kill) =>
          kill.subjectContext === context &&
          kill.timeSeconds === killTimeSeconds &&
          (kill.modelId === undefined || kill.modelId === modelId),
      ),
      "Missing corroborated world unit removal",
    );
    let previousTime = -Infinity;
    const paths = [];
    for (const { timeSeconds, speed, encodedWaypoints } of observations) {
      assert.ok(
        Number.isFinite(timeSeconds) &&
          timeSeconds >= creationTimeSeconds &&
          timeSeconds < killTimeSeconds &&
          timeSeconds >= previousTime,
      );
      previousTime = timeSeconds;
      assert.ok(Number.isFinite(speed) && speed >= 0);
      assert.ok(
        Array.isArray(encodedWaypoints) &&
          encodedWaypoints.length > 0 &&
          encodedWaypoints.every(
            (point) =>
              Array.isArray(point) &&
              point.length === 2 &&
              point.every(Number.isSafeInteger),
          ),
      );
      const [{ waypoints: points }] = movementWorldPaths(
        [{ encodedWaypoints }],
        proof.navgrid.movementOrigin,
      );
      assert.ok(
        points.every(
          ([x, z]) => x >= min[0] && x <= max[0] && z >= min[2] && z <= max[2],
        ),
        "Recorded world unit path lies outside Map11",
      );
      let length = 0;
      for (let index = 1; index < points.length; index++) {
        const [x, z] = points[index];
        const [previousX, previousZ] = points[index - 1];
        length += Math.hypot(x - previousX, z - previousZ);
      }
      const endTimeSeconds =
        speed === 0
          ? timeSeconds
          : Math.min(killTimeSeconds, timeSeconds + length / speed);
      paths.push({
        timeSeconds,
        endTimeSeconds,
        points,
        speeds: [{ timeSeconds, distance: 0, speed }],
      });
    }
    assert.ok(
      paths.length > 0,
      "A world unit requires recorded position evidence",
    );
    instances.push({
      context,
      participantId,
      creationTimeSeconds,
      killTimeSeconds,
      paths,
    });
  }
  assert.ok(
    usedModels.size > 0 && usedModels.size === models.size,
    "Every world unit asset requires a bound replay actor",
  );
  return { routes, bindings, instances };
}

async function loadLaneMinionModelRoutes(
  manifestPath,
  digest,
  identity,
  decoderBytes,
  { min, max },
  firstId,
) {
  const manifest = await readPinnedWorldUnitManifest(manifestPath, digest);
  assert.equal(manifest.kind, "exact-native-terrain-lane-minion-assets");
  assert.equal(manifest.build, identity.build);
  const proof = manifest.actorProof;
  assert.equal(proof.kind, "exact-terrain-lane-minion-waypoint-evidence");
  assertWorldUnitReplay(proof, identity, decoderBytes);
  assert.equal(proof.materialsSha256, manifest.materialsSha256);
  assert.equal(proof.mapBinSha256, manifest.mapBinSha256);
  assert.match(manifest.actorDigest, /^[a-f0-9]{64}$/);
  assert.match(proof.nativeReaderSha256, /^[a-f0-9]{64}$/);
  assert.match(proof.creationTableSha256, /^[a-f0-9]{64}$/);
  assert.ok(manifest.models.length > 0 && manifest.models.length <= 8);
  const { routes, bindings, models } = await loadWorldUnitAssets(
    manifestPath,
    manifest.models,
    firstId,
  );
  const contexts = new Set();
  const usedModels = new Set();
  const instances = proof.instances.map((actor) => {
    const {
      context,
      modelId,
      team,
      unitType,
      creationTimeSeconds,
      killTimeSeconds,
      removalTimeSeconds,
      creationPayloadSha256,
      paths,
    } = actor;
    assert.ok(team === 100 || team === 200);
    assert.ok(Number.isInteger(unitType) && unitType >= 4 && unitType <= 7);
    const faction = team === 100 ? "order" : "chaos";
    const variant = ["melee", "ranged", "siege", "super"][unitType - 4];
    assert.equal(modelId, `sru_${faction}minion${variant}`);
    const participantId = models.get(modelId);
    assert.ok(participantId !== undefined);
    usedModels.add(participantId);
    assert.ok(
      Number.isSafeInteger(context) && context > 0 && !contexts.has(context),
    );
    contexts.add(context);
    assert.match(creationPayloadSha256, /^[a-f0-9]{64}$/);
    assert.ok(
      Number.isFinite(creationTimeSeconds) &&
        creationTimeSeconds >= 0 &&
        creationTimeSeconds < killTimeSeconds &&
        killTimeSeconds < removalTimeSeconds &&
        removalTimeSeconds <= identity.durationMilliseconds / 1000,
      "Lane minion requires recorded creation, death, and removal clocks",
    );
    assert.ok(Array.isArray(paths) && paths.length > 0);
    let previousEnd = creationTimeSeconds;
    for (const { timeSeconds, endTimeSeconds, points, speeds } of paths) {
      assert.ok(
        timeSeconds >= previousEnd &&
          timeSeconds < endTimeSeconds &&
          endTimeSeconds <= killTimeSeconds,
        "Lane path must stay within the recorded life and remain ordered",
      );
      previousEnd = endTimeSeconds;
      assert.ok(
        points.length >= 2 &&
          points.every(
            ([x, z]) =>
              x >= min[0] && x <= max[0] && z >= min[2] && z <= max[2],
          ),
        "Lane path lies outside Map11",
      );
      const [knot] = speeds;
      assert.ok(
        speeds.length === 1 &&
          knot.timeSeconds === timeSeconds &&
          knot.distance === 0 &&
          Number.isFinite(knot.speed) &&
          knot.speed > 0,
      );
      let length = 0;
      for (let index = 1; index < points.length; index++) {
        const [x, z] = points[index];
        const [previousX, previousZ] = points[index - 1];
        length += Math.hypot(x - previousX, z - previousZ);
      }
      assert.ok(
        length > 0 &&
          endTimeSeconds <= timeSeconds + length / knot.speed + 1e-9,
        "Lane path would hold beyond the recorded route",
      );
    }
    return {
      context,
      participantId,
      teamId: team,
      creationTimeSeconds,
      killTimeSeconds,
      paths,
    };
  });
  assert.equal(usedModels.size, models.size);
  return { routes, bindings, instances };
}

function unpackWorldTransform(transform) {
  assert.ok(
    Array.isArray(transform) &&
      transform.length === 16 &&
      transform.every(Number.isFinite),
  );
  assert.deepEqual(
    [transform[3], transform[7], transform[11], transform[15]],
    [0, 0, 0, 1],
  );
  return {
    position: transform.slice(12, 15),
    basis: [
      ...transform.slice(0, 3),
      ...transform.slice(4, 7),
      ...transform.slice(8, 11),
    ],
  };
}

async function loadStructureModelRoutes(
  manifestPath,
  identity,
  placementSha256,
  turrets,
) {
  const exported = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(exported.schema, 1);
  assert.equal(exported.kind, "exact-native-terrain-structures");
  for (const field of ["build", "protocol", "replaySha256"])
    assert.equal(
      exported[field],
      identity[field],
      `Structure model ${field} mismatch`,
    );
  assert.equal(exported.placementReceiptSha256, placementSha256);
  return await loadStructureRenderRoutes(manifestPath, exported, turrets);
}

async function loadStructureRenderRoutes(manifestPath, exported, turrets) {
  const omissions = turrets.presentationOmissions ?? [];
  assert.deepEqual(exported.presentationOmissions ?? [], omissions);
  assert.equal(exported.instances.length, 22 - omissions.length);
  const omittedContexts = new Set(omissions.map(({ context }) => context));
  const { routes, assetIds, bindings } = await loadWorldModelBindings(
    manifestPath,
    exported.assets,
    "structure-models",
    0,
  );
  const openings = new Map(
    turrets.opening.map((instance) => [instance.context, instance]),
  );
  const losses = new Map(
    (turrets.renderableLosses ?? turrets.losses).map(
      ({ context, timeSeconds }) => [context, timeSeconds],
    ),
  );
  const seen = new Set();
  const usedAssets = new Set();
  const instances = exported.instances.map(
    ({ context, mapNameHash, transform, assetId, destroyedAtSeconds }) => {
      const surveyed = openings.get(context);
      const modelId = assetIds.get(assetId);
      assert.ok(
        surveyed &&
          modelId !== undefined &&
          !seen.has(context) &&
          !omittedContexts.has(context),
      );
      seen.add(context);
      usedAssets.add(modelId);
      assert.equal(mapNameHash, surveyed.mapNameHash);
      const { position, basis } = unpackWorldTransform(transform);
      assert.deepEqual(position, surveyed.worldPosition);
      assert.equal(destroyedAtSeconds, losses.get(context) ?? null);
      return {
        context,
        participantId: modelId,
        position,
        basis,
        destroyedAtSeconds,
      };
    },
  );
  assert.ok([...losses.keys()].every((context) => seen.has(context)));
  assert.equal(usedAssets.size, bindings.length);
  return { bindings, instances, routes, omissions, assetIds };
}

async function loadInhibitorModelRoutes(
  manifestPath,
  digest,
  identity,
  prepared,
  turrets,
  placementSha256,
  decoderOptions,
) {
  assert.match(digest, /^[a-f0-9]{64}$/);
  const source = await readFile(manifestPath);
  assert.equal(
    sha256(source),
    digest,
    "Inhibitor manifest digest differs from its pin",
  );
  const exported = JSON.parse(source);
  assert.equal(exported.schema, 1);
  assert.equal(exported.kind, "exact-native-terrain-inhibitors");
  for (const field of ["build", "protocol", "replaySha256"])
    assert.equal(
      exported[field],
      identity[field],
      `Inhibitor model ${field} mismatch`,
    );
  assert.equal(exported.placementReceiptSha256, placementSha256);
  assert.equal(
    exported.installedMapSha256,
    "ed38cba7aaa4390e8b2a2cfe778d5f1151152b9b97f2c90883c17b27b510d67a",
  );
  const byContext = (a, b) => a.context - b.context;
  assert.deepEqual(
    exported.turretAnchors.toSorted(byContext),
    turrets.opening.toSorted(byContext),
    "Inhibitor registration anchors differ from saved replay",
  );
  const { prepareNativeTerrainInhibitors } =
    await import("./research/native-terrain-inhibitors.mjs");
  const observed = prepareNativeTerrainInhibitors(prepared, decoderOptions);
  assert.notEqual(observed.losses, null);
  assert.deepEqual(exported.losses, observed.losses);
  const omissions = observed.presentationOmissions ?? [];
  assert.deepEqual(exported.presentationOmissions ?? [], omissions);
  assert.deepEqual(
    exported.unresolvedSnapshotStates ?? [],
    observed.unresolvedSnapshotStates ?? [],
  );
  const openingContexts = observed
    .read(0)
    .inhibitors.map(({ context }) => context);
  assert.deepEqual(
    exported.instances.map(({ context }) => context).sort((a, b) => a - b),
    openingContexts.sort((a, b) => a - b),
  );
  assert.equal(
    new Set(exported.instances.map(({ mapNameHash }) => mapNameHash)).size,
    6,
  );
  return await loadInhibitorRenderRoutes(manifestPath, exported, observed);
}

async function loadInhibitorRenderRoutes(manifestPath, exported, observed) {
  const omissions = observed.presentationOmissions ?? [];
  assert.deepEqual(Object.keys(exported.assets).sort(), [
    "inhibitor-0",
    "inhibitor-3",
  ]);
  const { routes, assetIds, bindings } = await loadWorldModelBindings(
    manifestPath,
    exported.assets,
    "inhibitor-models",
    110,
  );
  const lossTimes = new Map();
  for (const { context, timeSeconds } of observed.renderableLosses ??
    observed.losses)
    if (observed.inactivity === undefined || !lossTimes.has(context))
      lossTimes.set(context, timeSeconds);
  const omittedContexts = new Set(omissions.map(({ context }) => context));
  const instances = exported.instances.map(
    ({ context, assetId, transform, team }) => {
      assert.equal(team, assetId === "inhibitor-0" ? 100 : 200);
      const participantId = assetIds.get(assetId);
      assert.notEqual(participantId, undefined);
      const inactiveRanges = observed.inactivity?.get(context);
      return {
        context,
        participantId,
        ...unpackWorldTransform(transform),
        teamId: team,
        destroyedAtSeconds: lossTimes.get(context) ?? null,
        ...(inactiveRanges === undefined ? {} : { inactiveRanges }),
      };
    },
  );
  assert.equal(instances.filter(({ teamId }) => teamId === 100).length, 3);
  return {
    routes,
    bindings,
    losses: observed.losses,
    omittedContexts: [...omittedContexts],
    instances: instances.filter(({ context }) => !omittedContexts.has(context)),
  };
}

async function loadNexusModelRoutes(
  manifestPath,
  identity,
  { packetReader, observations },
  decoderBytes,
  placementSha,
) {
  const exported = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(exported.schema, 1);
  assert.equal(exported.kind, "exact-native-terrain-nexus");
  for (const field of ["build", "protocol", "replaySha256"])
    assert.equal(
      exported[field],
      identity[field],
      `Nexus model ${field} mismatch`,
    );
  assert.equal(exported.decoderSha256, sha256(decoderBytes));
  assert.equal(
    exported.map.installedMapSha256,
    "ed38cba7aaa4390e8b2a2cfe778d5f1151152b9b97f2c90883c17b27b510d67a",
  );
  return await loadNexusRenderRoutes(
    manifestPath,
    exported,
    identity,
    { packetReader, observations },
    placementSha,
  );
}

async function loadNexusRenderRoutes(
  manifestPath,
  exported,
  identity,
  { packetReader, observations },
  placementSha,
) {
  assert.deepEqual(Object.keys(exported.assets).sort(), ["nexus-0", "nexus-3"]);
  const { routes, assetIds, bindings } = await loadWorldModelBindings(
    manifestPath,
    exported.assets,
    "nexus-models",
    100,
  );
  const snapshots = packetReader.keyframes.map(
    ({ timeSeconds }) => timeSeconds,
  );
  const instances = exported.instances.map(
    ({ context, assetId, transform, observedKeyframeSeconds }) => {
      const participantId = assetIds.get(assetId);
      assert.ok(
        Number.isSafeInteger(context) &&
          context > 0 &&
          participantId !== undefined,
      );
      assert.deepEqual(observedKeyframeSeconds, snapshots);
      return { context, participantId, ...unpackWorldTransform(transform) };
    },
  );
  assert.equal(instances.length, 2);
  assert.equal(new Set(instances.map(({ context }) => context)).size, 2);
  assert.equal(
    new Set(instances.map(({ participantId }) => participantId)).size,
    2,
  );
  const current = identity.build === currentTerrainPositionBuild;
  const cue = current ? exported.terminalEvidence : exported.terminalPackets[0];
  if (current) {
    assert.deepEqual(exported.terminalPackets, []);
    assert.equal(exported.placementReceiptSha256, placementSha);
    assert.equal(exported.positionEvidence, "authored-registration");
    assert.equal(cue.opcode, 172);
    const terminal = observations.structures?.filter(
      ({ kind }) => kind === "match-ending-structure-loss",
    );
    assert.equal(terminal?.length, 1);
    for (const field of ["kind", "context", "timeSeconds", "secondTimeBits"])
      assert.equal(terminal[0][field], cue[field]);
  } else {
    assert.equal(exported.terminalPackets.length, 1);
    assert.equal(cue.opcode, 669);
    assert.equal(cue.animationName, "NexusDeath");
    assert.equal(
      cue.payloadSha256,
      "63be8511d25e00d09a0eaa068850153e0d750e18cffb0c523245b40c00fc158f",
    );
  }
  assert.ok(
    cue.timeSeconds > snapshots.at(-1) &&
      cue.timeSeconds <= packetReader.durationSeconds,
  );
  assert.ok(instances.some(({ context }) => context === cue.context));
  let opcode;
  let context = 0;
  const matching = [];
  for (const packet of packetReader.read(packetReader.durationSeconds)
    .packets) {
    if (packet.blockOffset === 0) {
      opcode = undefined;
      context = 0;
    }
    opcode = packet.explicitOpcode ?? opcode;
    context =
      packet.marker & 32
        ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
        : packet.paramBits;
    if (
      packet.stream === 1 &&
      opcode === cue.opcode &&
      context === cue.context &&
      packet.timeSeconds === cue.timeSeconds &&
      (!current || packet.secondTimeBits === cue.secondTimeBits) &&
      sha256(packet.payload) === cue.payloadSha256
    )
      matching.push(packet);
  }
  assert.equal(
    matching.length,
    1,
    "Nexus terminal evidence differs from saved replay",
  );
  return {
    bindings,
    instances,
    ...(current
      ? {
          terminalLoss: { context: cue.context, timeSeconds: cue.timeSeconds },
          terminalPayloadSha256: cue.payloadSha256,
        }
      : { cue: { context: cue.context, timeSeconds: cue.timeSeconds } }),
    routes,
    assetIds,
  };
}
const [bytes, receipts, , baseMetadata, baseMesh, projection] =
  await Promise.all([
    readFile(replayPath),
    Promise.all(
      receiptPaths.map(async (path) =>
        JSON.parse(await readFile(path, "utf8")),
      ),
    ),
    readPinned("map.mapgeo"),
    readPinned("map/map.json"),
    readPinned("map/map.bin"),
    readPinned("projection-proof.json"),
  ]);
const replayBuffer = new Uint8Array(bytes).buffer;
const replay = openReplay(replayBuffer);
const currentBuild = replay.build === currentTerrainPositionBuild;
const decodeChampionModels = values["champion-models-from-replay"] === true;
assert.ok(
  !decodeChampionModels ||
    (currentBuild &&
      rawReplayOnly &&
      privatePackageOutput !== undefined &&
      values["position-decoder"] !== undefined &&
      values["worker-decompressor"] !== undefined &&
      values["champion-models"] !== undefined &&
      values["champion-catalog-sha256"] !== undefined),
  "Replay-derived champion models require a private exact current worker package and a pinned archive catalog",
);
assert.ok(
  !values["player-state-from-replay"] ||
    (currentBuild &&
      privatePackageOutput !== undefined &&
      values["position-decoder"] !== undefined),
  "Replay-derived player state requires a private exact current worker package",
);
assert.ok(
  !decodeChampionStats || currentBuild,
  "Replay-decoded champion stats require the verified current build",
);
assert.ok(
  !decodeChampionInventory || currentBuild,
  "Replay-decoded champion inventory requires the verified current build",
);
assert.ok(
  !decodeChampionExperience || currentBuild,
  "Replay-decoded champion experience requires the verified current build",
);
assert.ok(
  animationCatalogPath === undefined || currentBuild,
  "Replay-decoded champion animations require the verified current build",
);
assert.ok(
  turretCatalogPath === undefined || currentBuild,
  "Authored turret catalogs require the verified current build",
);
assert.ok(
  announcerCatalogDirectory === undefined || currentBuild,
  "Replay-derived announcer audio requires the verified current build",
);
assert.ok(
  inhibitorCatalogPath === undefined || currentBuild,
  "Authored inhibitor catalogs require the verified current build",
);
assert.ok(
  nexusCatalogPath === undefined || currentBuild,
  "Authored Nexus catalogs require the verified current build",
);
if (currentBuild) {
  assert.ok(
    privatePackageOutput !== undefined &&
      values["champion-catalog-sha256"] !== undefined,
    "Current-build packages require a private output and a pinned champion catalog",
  );
} else {
  assert.equal(replay.build, terrainExportBuild);
}
const decoderOptions = { allowCurrentBuild: currentBuild };
const identity = {
  replaySha256: sha256(bytes),
  build: replay.build,
  protocol: replay.protocol,
  durationMilliseconds: replay.durationMilliseconds,
  participantCount: replay.roster.length,
};
const proof = JSON.parse(projection);
assert.equal(proof.build, terrainExportBuild);
assert.equal(identity.protocol, proof.protocol);
assert.equal(identity.participantCount, proof.participantCount);
const shortFixture =
  identity.replaySha256 ===
  "d7cabb0b7ba965f317863d128238847a0b9b0e4cc0cdbcfa3077c537b10fdf2b";
const reviewedReplay =
  shortFixture || identity.replaySha256 === proof.replaySha256;
if (canonicalMatchPath !== undefined) {
  const { verifyCanonicalRecordedRift } =
    await import("./research/verify-canonical-rift-replay.mjs");
  await verifyCanonicalRecordedRift(
    canonicalMatchPath,
    canonicalMatchDigest,
    replayPath,
    replay,
  );
}
if (riftStartupArchive !== undefined) {
  const { verifyNativeCurrentRiftStartup } =
    await import("./research/verify-native-current-rift-startup.mjs");
  await verifyNativeCurrentRiftStartup(riftStartupArchive, replayPath, replay);
}
if (shortFixture) {
  assert.ok(rawReplayOnly);
  assert.equal(identity.durationMilliseconds, 76063);
} else if (reviewedReplay) {
  for (const [field, value] of Object.entries(identity))
    assert.equal(proof[field], value);
} else if (
  canonicalMatchPath === undefined &&
  riftStartupArchive === undefined
) {
  assert.ok(recoveryPath, "Replay lacks reviewed Map11 provenance");
  const { verifyRecordedRift } =
    await import("./research/recorded-terrain-provenance.mjs");
  await verifyRecordedRift({ recoveryPath, replayPath, bytes, replay });
  assert.equal(sha256(await readFile(replayPath)), identity.replaySha256);
}
assert.equal(proof.staticMesh.sha256, localDigests["map/map.bin"]);
const infernalTerrainExport = values["infernal-terrain-export"];
const mountainTerrainExport = values["mountain-terrain-export"];
assert.ok(
  infernalTerrainExport === undefined || mountainTerrainExport === undefined,
  "Select one authored terrain export",
);
const variantTerrainExport = mountainTerrainExport ?? infernalTerrainExport;
const mountainTerrain = mountainTerrainExport !== undefined;
let metadata = baseMetadata;
let mesh = baseMesh;
let staticMesh = proof.staticMesh;
let terrainAssetDigests = localDigests;
if (variantTerrainExport !== undefined) {
  assert.ok(
    (terrainVisibilityPath !== undefined ||
      terrainControllerMaterialsPath !== undefined) &&
      values["terrain-materials"] !== undefined &&
      (!mountainTerrain || currentBuild),
    "Variant geometry requires its reviewed build, recorded visibility and materials",
  );
  [metadata, mesh] = await Promise.all([
    readFile(join(variantTerrainExport, "map.json")),
    readFile(join(variantTerrainExport, "map.bin")),
  ]);
  const metadataDigest = sha256(metadata);
  const meshDigest = sha256(mesh);
  assert.equal(
    metadataDigest,
    mountainTerrain
      ? "5b3ed6a403893e7c4f38aab225aeadb96c625283956ffd010d649de9b80a3ccc"
      : "4a8b2432fa3316647092fee062ff84c198f5e085ea11860aa4584082f46a889d",
  );
  assert.equal(
    meshDigest,
    mountainTerrain
      ? "437bb9c7fd9ea99268b0d2f6c417fe7af447c5645d451ee11daa7b9653d56636"
      : "c0419c77f44277f4e0257c1dae73a24d355461b87640318231e351cba208c61c",
  );
  assert.ok(mesh.subarray(0, baseMesh.length).equals(baseMesh));
  const original = JSON.parse(baseMetadata);
  const expanded = JSON.parse(metadata);
  assert.deepEqual(
    expanded.meshes.slice(0, original.meshes.length),
    original.meshes,
  );
  const replacements = expanded.meshes.slice(original.meshes.length);
  assert.equal(replacements.length, mountainTerrain ? 12 : 3);
  if (mountainTerrain) {
    assert.ok(replacements.every((entry) => entry.flags === 4));
    assert.equal(
      replacements.filter(({ controller }) => controller === 0x48106271).length,
      9,
    );
    assert.equal(
      replacements.filter(({ controller }) => controller === 0x1804e2e4).length,
      3,
    );
  } else {
    assert.ok(
      replacements.every(
        (entry) => entry.controller === 0xd1a17399 && entry.flags === 2,
      ),
    );
  }
  staticMesh = {
    ...staticMesh,
    exportedMeshes: expanded.meshes.length,
    meshTriangles: expanded.meshes.reduce(
      (total, entry) => total + entry.indexCount / 3,
      0,
    ),
    meshBytes: mesh.length,
    sha256: meshDigest,
  };
  terrainAssetDigests = {
    ...localDigests,
    "map/map.json": metadataDigest,
    "map/map.bin": meshDigest,
  };
}
const decompress = (input, target) =>
  zstdDecompressSync(input, { maxOutputLength: target.byteLength });
const decoderBytes =
  values["position-decoder"] === undefined
    ? undefined
    : await readFile(values["position-decoder"]);
const replayPreparation = prepareReplayForSeek(
  replayBuffer,
  decompress,
  decoderOptions,
);
let prepared = replayPreparation;
let championModelSelections;
let replayInventoryTracks;
let replayCodecs;
if (decoderBytes !== undefined) {
  const { createExactTerrainByteCodecs } =
    await import("./research/native-terrain-positions-944.mjs");
  const codecs = createExactTerrainByteCodecs(
    decoderBytes,
    identity,
    decoderOptions,
  );
  replayCodecs = codecs;
  const { binding } = bindNativeTerrainChampionIdentities(
    replayPreparation,
    codecs,
    decoderOptions,
  );
  const previous = replayPreparation.observations;
  const levels =
    binding.verified.length > previous.binding.verified.length
      ? readReplayActorLevels(replay, decompress, binding, decoderOptions)
      : previous.levels;
  prepared = {
    ...replayPreparation,
    observations: { ...previous, binding, levels },
  };
  if (decodeChampionInventory) {
    const { createRecordedInventoryCollector } =
      await import("./research/recorded-inventory-packets.mjs");
    const inventory = createRecordedInventoryCollector(
      replay,
      identity,
      prepared,
      codecs,
    );
    for (const packet of replayTimedPacketEnvelopes(
      replayPacketEnvelopes(replay, decompress),
    ))
      inventory.observe(packet);
    replayInventoryTracks = inventory.finish();
  }
  if (values["champion-catalog-sha256"] !== undefined)
    championModelSelections = readChampionModelSelections(
      prepared,
      codecs,
      decoderOptions,
    );
}
const { observations } = prepared;
const trace = rawReplayOnly
  ? null
  : createNativePositionSceneTrace(identity, observations, receipts).trace;
const { participants } =
  trace ?? bindNativeSceneParticipants(identity, observations);
const contexts = new Map(
  observations.binding.verified.map(({ footerRow, context }) => [
    footerRow,
    context,
  ]),
);
const teams = new Map(
  participants.map(({ participantId, teamId }) => [participantId, teamId]),
);
const captured = new Map();
for (const { samples } of receipts) {
  for (const { time, key, position } of samples) {
    if (!captured.has(time)) captured.set(time, new Map());
    captured.get(time).set(contexts.get(key), position);
  }
}
const { min, max } = proof.mapBounds;
const frames = (trace?.frames ?? []).map(({ timeSeconds, actors }) => ({
  timeSeconds,
  markers: actors.map(({ participantId, x, y }) => {
    const position = captured.get(timeSeconds).get(participantId);
    assert.deepEqual([position[0], position[2]], [x, y]);
    assert.ok(
      [0, 2].every(
        (axis) => position[axis] >= min[axis] && position[axis] <= max[axis],
      ),
    );
    return { participantId, position, teamId: teams.get(participantId) };
  }),
}));
const scene = {
  identity,
  ...(replay.winningTeam === null || values["player-state-from-replay"]
    ? {}
    : { winningTeam: replay.winningTeam }),
  mapBounds: proof.mapBounds,
  meshBounds: proof.meshBounds,
  staticMesh,
  assetDigests: terrainAssetDigests,
  participants,
  frames,
};
if (cameraGlobalsPath !== undefined)
  scene.followCameraDefaults = readExactClassicCameraDefaults(
    await readFile(cameraGlobalsPath),
  );
if (visionPath !== undefined) {
  const visionBytes = await readFile(visionPath);
  assert.match(visionDigest, /^[a-f0-9]{64}$/);
  assert.equal(
    sha256(visionBytes),
    visionDigest,
    "Recorded team vision digest differs from its pin",
  );
  const vision = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(visionBytes),
  );
  assert.equal(vision.kind, "exact-scout-team-vision");
  assert.equal(vision.build, identity.build);
  assert.equal(vision.protocol, identity.protocol);
  assert.equal(
    vision.replaySha256,
    identity.replaySha256,
    "Team vision belongs to another saved replay",
  );
  assert.ok(Array.isArray(vision.tracks) && vision.tracks.length > 0);
  scene.teamVision = vision.tracks;
}
let materialRoutes;
if (values["terrain-materials"] !== undefined) {
  const mats = await loadTerrainMaterials(
    values["terrain-materials"],
    JSON.parse(metadata).meshes,
    { ...proof, staticMesh },
    terrainAssetDigests,
  );
  materialRoutes = mats.routes;
  scene.terrainMaterials = {
    bindings: mats.bindings,
    texturedTriangles: mats.texturedTriangles,
  };
}
// The base export omits Infernal replacements. Preserve the existing
// conservative omission when a match lacks the reviewed base-variant evidence.
const reviewedBaseTerrainReplay =
  currentBuild &&
  identity.replaySha256 ===
    "a7eff15aa08dd60e52a9c7e289aa99cfaf06fdd4edd789c1999ccef9fc5b7fa1";
const missingReplacementMeshControllerIds =
  infernalTerrainExport === undefined && !reviewedBaseTerrainReplay
    ? [0x4aefd282, 0xa8951ff3]
    : [];
if (terrainVisibilityPath !== undefined) {
  assert.ok(
    materialRoutes,
    "Terrain visibility requires reviewed terrain materials",
  );
  const bytes = await readFile(terrainVisibilityPath);
  const reviewedDigests = [
    "39970872e3dda6634c1389be84947fd06d7305c7d519558d9dd248e43517b766",
    "f4cca91d895b984af25b5ce76814ad09a230571660265cda8f69dca7950fc0dc",
    "060b9ea9cd7228f81c78f89979b426782b3a1342d02420466b86f85933f154db",
    "41e89c0f415121960d48ab1f9930a2e29f2c650f3ac51ad2516697be6f3e91e8",
  ];
  const digest = sha256(bytes);
  assert.ok(
    terrainVisibilityDigest === undefined
      ? reviewedDigests.includes(digest)
      : terrainVisibilityDigest === digest,
    "Terrain visibility does not match a native controller receipt",
  );
  const receipt = JSON.parse(bytes);
  assert.equal(receipt.replaySha256, identity.replaySha256);
  assert.equal(receipt.build, identity.build);
  assert.equal(receipt.protocol, identity.protocol);
  assert.equal(receipt.geometrySha256, terrainAssetDigests["map/map.json"]);
  assert.equal(
    receipt.materialsSha256,
    "ed38cba7aaa4390e8b2a2cfe778d5f1151152b9b97f2c90883c17b27b510d67a",
  );
  const omittedMeshControllerIds =
    terrainVisibilityDigest === undefined
      ? []
      : validateRecordedTerrainVisibility(
          receipt,
          JSON.parse(metadata).meshes,
          replay.duration,
          { omitUnresolved: currentBuild },
        );
  scene.terrainVisibility = {
    tracks: receipt.tracks.filter(
      ({ controllerId }) =>
        !missingReplacementMeshControllerIds.includes(controllerId),
    ),
    unresolvedMeshControllerIds: receipt.unresolvedMeshControllerIds,
    missingReplacementMeshControllerIds,
    ...(omittedMeshControllerIds.length === 0
      ? {}
      : { omittedMeshControllerIds }),
    ...(currentBuild && receipt.unresolvedWindows !== undefined
      ? {
          unresolvedWindows: receipt.unresolvedWindows.filter(
            ({ controllerId }) =>
              !missingReplacementMeshControllerIds.includes(controllerId),
          ),
        }
      : {}),
  };
}
let championModelRoutes;
let championModelCatalog;
let verifiedChampionModels;
if (decodeChampionModels) {
  const index = await loadChampionModelCatalogIndex(
    values["champion-models"],
    values["champion-catalog-sha256"],
    identity,
  );
  championModelCatalog = index.championModelCatalog;
  championModelRoutes = index.routes;
  verifiedChampionModels = prepareCurrentChampionModelBindings(
    championModelCatalog,
    observations,
    championModelSelections,
  );
} else if (values["champion-models"] !== undefined) {
  const pin = values["champion-catalog-sha256"];
  const models =
    pin === undefined
      ? await loadLegacyChampionModelRoutes(
          values["champion-models"],
          identity,
          observations,
        )
      : await loadChampionModelCatalog(
          values["champion-models"],
          pin,
          identity,
          championModelSelections,
        );
  championModelRoutes = models.routes;
  scene.championModels = { bindings: models.bindings };
}
let structureModelRoutes;
let inhibitorModelRoutes;
let inhibitorCatalog;
let turretCatalog;
let verifiedTurretModels;
let verifiedTurretLosses;
let placementSha;
let nexus;
let nexusCatalog;
let verifiedNexusModels;
if (values["turret-placements"] !== undefined) {
  const { prepareNativeTerrainTurrets, turretPlacementReceiptDigests } =
    await import("./research/native-terrain-turrets.mjs");
  const placementBytes = await readFile(values["turret-placements"]);
  placementSha = sha256(placementBytes);
  assert.equal(
    placementSha,
    turretPlacementReceiptDigests[identity.build],
    "Map11 turret placement receipt digest differs from the reviewed file",
  );
  const placementReceipt = JSON.parse(placementBytes);
  const turrets = prepareNativeTerrainTurrets(
    prepared,
    placementReceipt,
    decoderOptions,
  );
  const losses = turrets.renderableLosses ?? turrets.losses;
  for (const { worldPosition } of losses) {
    assert.ok(
      [0, 2].every(
        (axis) =>
          worldPosition[axis] >= min[axis] && worldPosition[axis] <= max[axis],
      ),
      "Verified turret lies outside the displayed world",
    );
  }
  if (decodeTurrets) verifiedTurretLosses = losses;
  else scene.turretLosses = losses;
  let structures;
  if (turretCatalogPath !== undefined) {
    const { bindNativeTerrainTurretCatalog } =
      await import("./research/native-terrain-turret-catalog.mjs");
    const catalog = await readPinnedWorldUnitManifest(
      turretCatalogPath,
      turretCatalogDigest,
    );
    assert.equal(catalog.placementReceiptSha256, placementSha);
    const bound = bindNativeTerrainTurretCatalog(
      prepared,
      placementReceipt,
      catalog,
      decoderOptions,
      turrets,
    );
    structures = await loadStructureRenderRoutes(
      turretCatalogPath,
      { ...bound, assets: catalog.assets },
      turrets,
    );
    if (decodeTurrets) {
      const { projectCurrentTurretCatalog } =
        await import("./research/native-terrain-turret-catalog-author.mjs");
      turretCatalog = projectCurrentTurretCatalog(
        catalog,
        structures.assetIds,
        placementReceipt,
      );
    }
  } else if (values["structure-models"] !== undefined)
    structures = await loadStructureModelRoutes(
      values["structure-models"],
      identity,
      placementSha,
      turrets,
    );
  if (structures !== undefined) {
    const structureModels = {
      instances: structures.instances,
      ...(structures.omissions.length === 0
        ? {}
        : {
            omittedContexts: structures.omissions.map(({ context }) => context),
          }),
    };
    if (decodeTurrets) {
      verifiedTurretModels = structureModels;
      const { currentTurretArchiveModels } =
        await import("./research/native-terrain-turret-assets.mjs");
      const rubbleById = new Map(
        turretCatalog.models.map(([asset, id]) => [
          id,
          currentTurretArchiveModels[asset].settledRubble,
        ]),
      );
      scene.structureModelBindings = structures.bindings.map((binding) => ({
        ...binding,
        settledRubble: rubbleById.get(binding.participantId),
      }));
      if (chaosTurretCollapseDirectory !== undefined) {
        const { chaosTurretCollapseModelPath, chaosTurretCollapsePaths } =
          await import("./research/native-terrain-turret-collapse-assets.mjs");
        const binding = scene.structureModelBindings.find(
          ({ participantId }) => participantId === 1,
        );
        assert.equal(binding?.url, chaosTurretCollapseModelPath);
        const inputs = [
          [
            "joint-bindings.json",
            chaosTurretCollapsePaths.bindings,
            "application/json",
          ],
          [
            "collapse.clip",
            chaosTurretCollapsePaths.clip,
            "application/octet-stream",
          ],
          [
            "model.skl",
            chaosTurretCollapsePaths.rig,
            "application/octet-stream",
          ],
        ];
        for (const [file, route, mime] of inputs) {
          const resource = await readFile(
            join(chaosTurretCollapseDirectory, file),
          );
          assert.equal(
            sha256(resource),
            route.split("/").at(-1).split(".")[0],
            `Unreviewed Chaos turret collapse asset: ${file}`,
          );
          structures.routes.set(route, [resource, mime]);
        }
        binding.collapse = chaosTurretCollapsePaths;
      }
    } else
      scene.structureModels = {
        bindings: structures.bindings,
        ...structureModels,
      };
    structureModelRoutes = structures.routes;
  }
  let inhibitors;
  if (decodeInhibitors) {
    const { projectCurrentInhibitorCatalog } =
      await import("./research/native-terrain-inhibitor-catalog-author.mjs");
    const catalog = await readPinnedWorldUnitManifest(
      inhibitorCatalogPath,
      inhibitorCatalogDigest,
    );
    assert.equal(catalog.placementReceiptSha256, placementSha);
    const { bindings, assetIds, routes } = await loadWorldModelBindings(
      inhibitorCatalogPath,
      catalog.assets,
      "inhibitor-models",
      110,
    );
    inhibitorCatalog = projectCurrentInhibitorCatalog(
      catalog,
      assetIds,
      placementReceipt,
    );
    scene.inhibitorModelBindings = bindings.map((binding) => ({
      ...binding,
      inactiveModelRange: "Destroyed",
    }));
    inhibitorModelRoutes = routes;
  } else if (inhibitorCatalogPath !== undefined) {
    const [
      { bindNativeTerrainInhibitorCatalog },
      { readCurrentInhibitorPacketState },
    ] = await Promise.all([
      import("./research/native-terrain-inhibitor-catalog.mjs"),
      import("./research/native-terrain-inhibitor-packet.mjs"),
    ]);
    const catalog = await readPinnedWorldUnitManifest(
      inhibitorCatalogPath,
      inhibitorCatalogDigest,
    );
    const bound = bindNativeTerrainInhibitorCatalog(
      prepared,
      placementReceipt,
      catalog,
      {
        ...decoderOptions,
        readCurrentInhibitorPacket: readCurrentInhibitorPacketState,
        currentInhibitorPackets: replayTimedPacketEnvelopes(
          replayPacketEnvelopes(replay, decompress),
        ),
      },
      turrets,
    );
    inhibitors = await loadInhibitorRenderRoutes(
      inhibitorCatalogPath,
      { ...bound, assets: catalog.assets },
      bound,
    );
  } else if (values["inhibitor-models"] !== undefined)
    inhibitors = await loadInhibitorModelRoutes(
      values["inhibitor-models"],
      values["inhibitor-models-sha256"],
      identity,
      prepared,
      turrets,
      placementSha,
      decoderOptions,
    );
  if (inhibitors !== undefined) {
    scene.inhibitorModels = {
      bindings: inhibitors.bindings,
      instances: inhibitors.instances,
      ...(inhibitors.omittedContexts.length === 0
        ? {}
        : { omittedContexts: inhibitors.omittedContexts }),
    };
    scene.inhibitorLosses = inhibitors.losses.map(({ timeSeconds }) => ({
      timeSeconds,
    }));
    inhibitorModelRoutes = inhibitors.routes;
  }
  if (nexusCatalogPath !== undefined) {
    const { bindNativeTerrainNexusCatalog } =
      await import("./research/native-terrain-nexus-catalog.mjs");
    const catalog = await readPinnedWorldUnitManifest(
      nexusCatalogPath,
      nexusCatalogDigest,
    );
    const bound = bindNativeTerrainNexusCatalog(
      prepared,
      placementReceipt,
      catalog,
      replayCodecs,
      decoderOptions,
      turrets,
    );
    nexus = await loadNexusRenderRoutes(
      nexusCatalogPath,
      {
        ...bound,
        assets: catalog.assets,
        placementReceiptSha256: catalog.placementReceiptSha256,
        positionEvidence: "authored-registration",
      },
      identity,
      prepared,
      placementSha,
    );
    if (decodeNexus) {
      const { projectCurrentNexusCatalog } =
        await import("./research/native-terrain-nexus-catalog-author.mjs");
      nexusCatalog = projectCurrentNexusCatalog(
        catalog,
        nexus.assetIds,
        placementReceipt,
      );
    }
  }
}
let nexusModelRoutes;
if (values["nexus-models"] !== undefined)
  nexus = await loadNexusModelRoutes(
    values["nexus-models"],
    identity,
    prepared,
    decoderBytes,
    placementSha,
  );
if (nexus !== undefined) {
  const nexusModels = {
    instances: nexus.instances,
    ...(nexus.cue === undefined
      ? { terminalLoss: nexus.terminalLoss }
      : { cue: nexus.cue }),
  };
  if (decodeNexus) {
    verifiedNexusModels = {
      ...nexusModels,
      terminalLoss: {
        ...nexus.terminalLoss,
        payloadSha256: nexus.terminalPayloadSha256,
      },
    };
    scene.nexusModelBindings = nexus.bindings;
  } else scene.nexusModels = { bindings: nexus.bindings, ...nexusModels };
  nexusModelRoutes = nexus.routes;
}
let navgridBytes;
let motionWorker;
let groundHeight;
if (decoderBytes !== undefined) {
  const heightBytes = await readPinned("heights.bin");
  assert.equal(sha256(heightBytes), proof.navgrid.heightsSha256);
  const { x: columns, z: rows, step, heightSamples } = proof.navgrid;
  assert.equal(
    heightBytes.byteLength,
    heightSamples * Float32Array.BYTES_PER_ELEMENT,
  );
  assert.equal(columns * rows, heightSamples);
  const heights = new Float32Array(
    heightBytes.buffer,
    heightBytes.byteOffset,
    heightSamples,
  );
  const navgrid = { columns, rows, step };
  groundHeight = createNavgridGroundHeight(proof.mapBounds, navgrid, heights);
  for (const frame of frames) {
    for (const {
      position: [x, y, z],
    } of frame.markers) {
      const ground = groundHeight(x, z);
      assert.ok(ground !== null && Math.abs(ground - y) < 0.001);
    }
  }
  const waypointOrigin = proof.navgrid.movementOrigin;
  if (values["worker-decompressor"] !== undefined) {
    const { createPreparedTerrainByteCodecs } =
      await import("./research/native-terrain-byte-codecs.mjs");
    await createPreparedTerrainByteCodecs(
      decoderBytes,
      identity,
      decoderOptions,
    );
    motionWorker = {
      script: await buildMotionWorker(values["worker-decompressor"]),
      decoderBytes,
    };
    scene.workerMotion = {
      waypointOrigin,
      ...(currentBuild ? decoderOptions : {}),
      ...(decodeChampionStats ? { decodeChampionStats: true } : {}),
      ...(decodeChampionInventory ? { decodeChampionInventory: true } : {}),
      ...(decodeChampionExperience ? { decodeChampionExperience: true } : {}),
      ...(championModelCatalog === undefined ? {} : { championModelCatalog }),
      ...(inhibitorCatalog === undefined ? {} : { inhibitorCatalog }),
      ...(turretCatalog === undefined ? {} : { turretCatalog }),
      ...(nexusCatalog === undefined ? {} : { nexusCatalog }),
    };
  } else {
    const [
      { createPosition944Reader },
      { prepareNativeTerrainChampionKeyframes },
      { createWaypointReader },
      { createMoveSpeed309Reader },
      { prepareNativeTerrainMotion },
    ] = await Promise.all([
      import("./research/native-terrain-positions-944.mjs"),
      import("./research/native-terrain-champion-keyframes.mjs"),
      import("./research/native-terrain-waypoints.mjs"),
      import("./research/native-terrain-move-speed.mjs"),
      import("./research/native-terrain-motion.mjs"),
    ]);
    const keyframes = prepareNativeTerrainChampionKeyframes(
      prepared,
      createPosition944Reader(decoderBytes, identity),
    );
    scene.decodedPositionFrames = keyframes.frames
      .filter(({ markers }) => markers.length > 0)
      .map(({ timeSeconds, markers }) => ({
        timeSeconds,
        markers: markers.map(({ participantId, x, z }) => {
          const height = groundHeight(x, z);
          assert.ok(
            height !== null,
            "Verified champion keyframe is outside Map11",
          );
          return {
            participantId,
            position: [x, height, z],
            teamId: teams.get(participantId),
          };
        }),
      }));
    const { motion, coverage } = prepareNativeTerrainMotion(
      prepared,
      keyframes,
      replayTimedPacketEnvelopes(replayPacketEnvelopes(replay, decompress)),
      {
        readWaypoints: createWaypointReader(decoderBytes, identity),
        readMoveSpeed: createMoveSpeed309Reader(decoderBytes, identity),
        waypointOrigin,
      },
    );
    scene.motion = motion;
    scene.motionCoverage = coverage;
  }
  scene.navgrid = navgrid;
  scene.minimap = true;
  navgridBytes = heightBytes;
}
const worldUnitModelRoutes = new Map();
let replayWorldUnits;
if (scoutScene) {
  let dragonKills;
  if (
    reviewedReplay ||
    values["world-unit-models"] !== undefined ||
    (!currentBuild && announcerDirectory !== undefined)
  ) {
    const { decodeRecordedDragonKills } =
      await import("./research/recorded-dragon-kills.mjs");
    dragonKills = decodeRecordedDragonKills(replayBuffer, decompress).events;
    scene.dragonKills = dragonKills.map(({ timeSeconds, actorContext }) => ({
      timeSeconds,
      actorContext,
    }));
  }
  if (values["world-unit-models"] !== undefined) {
    const units = await loadWorldUnitModelRoutes(
      values["world-unit-models"],
      values["world-unit-models-sha256"],
      identity,
      decoderBytes,
      proof,
      dragonKills,
    );
    for (const [path, response] of units.routes)
      worldUnitModelRoutes.set(path, response);
    scene.worldUnitModels = {
      bindings: units.bindings,
      instances: units.instances,
    };
  }
  if (values["neutral-unit-models"] !== undefined) {
    const { decodeRecordedNeutralObjectives } =
      await import("./research/recorded-neutral-objectives.mjs");
    const objectives = decodeRecordedNeutralObjectives(
      replay,
      decoderBytes,
      decompress,
    );
    assert.ok(objectives, "Neutral unit models require the reviewed replay");
    const existing = scene.worldUnitModels ?? { bindings: [], instances: [] };
    const units = await loadWorldUnitModelRoutes(
      values["neutral-unit-models"],
      values["neutral-unit-models-sha256"],
      identity,
      decoderBytes,
      proof,
      objectives.events,
      200 + existing.bindings.length,
      objectives.actors,
    );
    const occupied = new Set(existing.instances.map(({ context }) => context));
    assert.ok(
      units.instances.every(({ context }) => !occupied.has(context)),
      "Neutral and other world units cannot share a context",
    );
    for (const [path, response] of units.routes) {
      assert.ok(
        !worldUnitModelRoutes.has(path),
        "Repeated world unit asset route",
      );
      worldUnitModelRoutes.set(path, response);
    }
    scene.worldUnitModels = {
      bindings: [...existing.bindings, ...units.bindings],
      instances: [...existing.instances, ...units.instances],
    };
    assert.ok(
      groundHeight,
      "Neutral objective positions require Map11 heights",
    );
    scene.neutralObjectiveKills = objectives.events.map(
      ({ timeSeconds, actorContext, modelId, encodedKillPosition }) => {
        const event = { timeSeconds, actorContext, modelId };
        if (!encodedKillPosition) return event;
        const [
          {
            waypoints: [[x, z]],
          },
        ] = movementWorldPaths(
          [{ encodedWaypoints: [encodedKillPosition] }],
          proof.navgrid.movementOrigin,
        );
        const y = groundHeight(x, z);
        assert.ok(
          y !== null,
          "Neutral objective kill position lies outside Map11",
        );
        return { ...event, position: [x, y, z] };
      },
    );
  }
  if (values["lane-minion-models"] !== undefined) {
    const existing = scene.worldUnitModels ?? { bindings: [], instances: [] };
    const units = await loadLaneMinionModelRoutes(
      values["lane-minion-models"],
      values["lane-minion-models-sha256"],
      identity,
      decoderBytes,
      proof.mapBounds,
      200 + existing.bindings.length,
    );
    const occupied = new Set(existing.instances.map(({ context }) => context));
    assert.ok(
      units.instances.every(({ context }) => !occupied.has(context)),
      "Lane minion and other world units cannot share a context",
    );
    for (const [path, response] of units.routes)
      worldUnitModelRoutes.set(path, response);
    scene.worldUnitModels = {
      bindings: [...existing.bindings, ...units.bindings],
      instances: [...existing.instances, ...units.instances],
    };
  }
  if (neutralModelCatalogPath !== undefined) {
    assert.ok(
      currentBuild && scene.workerMotion && replayCodecs,
      "Replay-derived neutral objectives require the exact current motion worker",
    );
    const { readCurrentNeutralModelCatalog } =
      await import("./native-terrain-neutral-model-catalog.mjs");
    const { createCurrentNeutralObjectiveCollector } =
      await import("./research/recorded-current-neutral-objectives.mjs");
    const { prepareCurrentNeutralObjectiveScene, readCurrentNeutralCampSkins } =
      await import("./research/recorded-current-neutral-objective-scene.mjs");
    const { createWaypointReaderFromCodecs } =
      await import("./research/native-terrain-waypoints-reader.mjs");
    const collector = createCurrentNeutralObjectiveCollector({
      replay,
      binding: observations.binding,
      codecs: replayCodecs,
      readWaypoints: createWaypointReaderFromCodecs(replayCodecs),
      includeCamps: neutralCampCatalogPath !== undefined,
      includeKeyframeAnchors: neutralCampCatalogPath !== undefined,
    });
    for (const packet of replayTimedPacketEnvelopes(
      replayPacketEnvelopes(replay, decompress),
    ))
      collector.observe(packet);
    const evidence = collector.finish();
    const { models } = await readCurrentNeutralModelCatalog(
      neutralModelCatalogPath,
      values["neutral-model-catalog-sha256"],
      evidence.actors.map(({ modelId }) => modelId),
    );
    const skinRows = [];
    if (neutralCampCatalogPath !== undefined) {
      const { readCurrentCampModelCatalog } =
        await import("./native-terrain-camp-model-catalog.mjs");
      const camps = await readCurrentCampModelCatalog(
        neutralCampCatalogPath,
        values["neutral-camp-model-catalog-sha256"],
        identity,
      );
      const requested = new Set(
        evidence.campActors.map(({ modelId }) => modelId),
      );
      for (const [modelId, model] of camps.models) {
        assert.ok(!models.has(modelId), "Duplicate authored neutral model");
        if (!requested.has(modelId)) continue;
        models.set(modelId, model);
        skinRows.push([modelId, model.requestedSkinId]);
      }
      scene.workerMotion.decodeNeutralCamps = true;
      scene.workerMotion.neutralCampSkins = skinRows;
    }
    const existing = scene.worldUnitModels ?? { bindings: [], instances: [] };
    const modelIds = new Map();
    const bindings = [];
    for (const [modelId, { model, skinScale, hiddenRanges, bytes }] of models) {
      const participantId = 200 + existing.bindings.length + bindings.length;
      const url = `/world-unit-models/${model.sha256}.glb`;
      assert.ok(
        !worldUnitModelRoutes.has(url),
        "Duplicate neutral model route",
      );
      worldUnitModelRoutes.set(url, [bytes, "model/gltf-binary"]);
      modelIds.set(modelId, participantId);
      bindings.push({ participantId, skinScale, hiddenRanges, url });
    }
    const { neutralObjectiveInstances } = prepareCurrentNeutralObjectiveScene({
      evidence,
      modelIds,
      waypointOrigin: proof.navgrid.movementOrigin,
      durationSeconds: replay.duration,
      includeCamps: neutralCampCatalogPath !== undefined,
      campSkins:
        neutralCampCatalogPath === undefined
          ? undefined
          : readCurrentNeutralCampSkins(skinRows, modelIds),
    });
    const occupied = new Set(existing.instances.map(({ context }) => context));
    assert.ok(
      neutralObjectiveInstances.every(({ context }) => !occupied.has(context)),
      "Neutral and other world units cannot share a context",
    );
    scene.neutralObjectiveModelBindings = bindings;
    scene.workerMotion.neutralObjectiveModels = [...modelIds];
    replayWorldUnits = {
      bindings: [...existing.bindings, ...bindings],
      instances: [...existing.instances, ...neutralObjectiveInstances],
    };
  }
  if (laneMinionCatalogPath !== undefined) {
    assert.ok(
      currentBuild && scene.workerMotion && replayCodecs,
      "Replay-derived lane minions require the exact current motion worker",
    );
    const { readCurrentLaneMinionCatalog } =
      await import("./native-terrain-lane-minion-catalog.mjs");
    const { models: assets, barracksPlacements } =
      await readCurrentLaneMinionCatalog(
        laneMinionCatalogPath,
        values["lane-minion-model-catalog-sha256"],
        values["lane-minion-map-materials"],
        values["lane-minion-map-definitions"],
      );
    const existing = replayWorldUnits ??
      scene.worldUnitModels ?? { bindings: [], instances: [] };
    const units = await loadWorldUnitAssets(
      laneMinionCatalogPath,
      assets,
      200 + existing.bindings.length,
    );
    const { readCurrentLaneMinionTracks } =
      await import("./research/recorded-lane-minion-tracks.mjs");
    const { instances } = readCurrentLaneMinionTracks({
      replay,
      packets: replayTimedPacketEnvelopes(
        replayPacketEnvelopes(replay, decompress),
      ),
      codecs: replayCodecs,
      movementOrigin: proof.navgrid.movementOrigin,
      barracksPlacements,
    });
    const occupied = new Set(existing.instances.map(({ context }) => context));
    const laneInstances = instances.map(
      ({
        context,
        modelId,
        team,
        creationTimeSeconds,
        killTimeSeconds,
        paths,
      }) => {
        const participantId = units.models.get(modelId);
        assert.ok(
          participantId !== undefined && !occupied.has(context),
          "Replay-derived lane model or actor binding differs",
        );
        return {
          context,
          participantId,
          teamId: team,
          creationTimeSeconds,
          killTimeSeconds,
          paths,
        };
      },
    );
    for (const [path, response] of units.routes) {
      assert.ok(
        !worldUnitModelRoutes.has(path),
        "Duplicate lane minion model route",
      );
      worldUnitModelRoutes.set(path, response);
    }
    scene.laneMinionModelBindings = units.bindings;
    scene.workerMotion.laneMinionCatalog = {
      barracksPlacements,
      models: [...units.models],
    };
    replayWorldUnits = {
      bindings: [...existing.bindings, ...units.bindings],
      instances: [...existing.instances, ...laneInstances],
    };
  }
  if (scene.inhibitorLosses === undefined && !currentBuild) {
    const { prepareNativeTerrainInhibitors } =
      await import("./research/native-terrain-inhibitors.mjs");
    const { losses } = prepareNativeTerrainInhibitors(prepared);
    if (losses !== null)
      scene.inhibitorLosses = losses.map(({ timeSeconds }) => ({
        timeSeconds,
      }));
  }
  if (values["player-state-from-replay"]) {
    assert.ok(scene.workerMotion && currentBuild);
    readCurrentRecordedPlayerState(
      replay,
      replayPreparation.observations,
      observations.binding,
    );
    scene.workerMotion.decodePlayerState = true;
  } else {
    Object.assign(
      scene,
      projectRecordedPlayerState(
        observations,
        new Set(participants.map(({ participantId }) => participantId)),
      ),
    );
  }
}
const itemRoutes = new Map();
if (
  championStatInputs.length > 0 ||
  includeInventory ||
  decodeChampionExperience
) {
  const {
    admitRecordedChampionStats,
    championExperienceSceneSchema,
    championExperienceThresholdsSchema,
    readChampionExperienceTracks,
  } = await import("../scout-terrain-champion-stats.ts");
  const appRoot = fileURLToPath(
    new URL(
      "../../../../../packages/scout-for-lol/packages/app/",
      import.meta.url,
    ),
  );
  const { z } = await import(Bun.resolveSync("zod", appRoot));
  const roster = scene.participants.map(({ participantId }) => participantId);
  let experienceThresholds;
  if (experienceMapPath !== undefined) {
    const { readRecordedExperienceThresholds } =
      await import("./research/recorded-champion-experience.mjs");
    experienceThresholds = championExperienceThresholdsSchema(z).parse(
      readRecordedExperienceThresholds(
        await readFile(experienceMapPath),
        identity.build,
      ),
    );
    if (decodeChampionExperience)
      scene.championExperienceThresholds = experienceThresholds;
  }
  for (const { kind, field, path, digest } of championStatInputs) {
    const bytes = await readFile(path);
    assert.equal(
      sha256(bytes),
      digest,
      `Recorded champion ${kind} digest differs`,
    );
    const tracks = admitRecordedChampionStats(
      z,
      JSON.parse(bytes.toString("utf8")),
      scene.identity,
      roster,
      kind,
    );
    if (kind === "experience") {
      const experience = championExperienceSceneSchema(z).parse({
        thresholds: experienceThresholds,
        tracks,
      });
      readChampionExperienceTracks(
        experience,
        roster,
        scene.identity.durationMilliseconds,
      );
      scene.championExperience = experience;
    } else {
      scene[field] = tracks;
    }
  }
  if (includeInventory) {
    const { itemIdsForTracks, readRecordedInventory, replayItemAssetSchema } =
      await import("../scout-terrain-inventory.ts");
    const { inventoryIconDimensions, currentInventoryAssetSource } =
      await import("./research/prepare-exact-inventory-assets.mjs");
    const { verifyRecordedInventoryFooter } =
      await import("./research/verify-recorded-inventory-footer.mjs");
    const itemAssetBytes = await readFile(itemAssetsPath);
    assert.equal(
      sha256(itemAssetBytes),
      itemAssetsDigest,
      "Exact replay item asset manifest digest differs",
    );
    let tracks = replayInventoryTracks;
    if (inventoryPath !== undefined) {
      const inventoryBytes = await readFile(inventoryPath);
      assert.equal(
        sha256(inventoryBytes),
        inventoryDigest,
        "Recorded inventory digest differs",
      );
      tracks = readRecordedInventory(
        z,
        JSON.parse(inventoryBytes.toString("utf8")),
        scene.identity,
        roster,
      );
      verifyRecordedInventoryFooter(bytes, scene.participants, tracks);
    }
    const sourceIdentity = currentBuild
      ? {
          installedExeSha256: z.literal(
            currentInventoryAssetSource.installedExeSha256,
          ),
          archiveIndexSha256: z.object({
            global: z.literal(
              currentInventoryAssetSource.archiveIndexSha256.global,
            ),
            localized: z.literal(
              currentInventoryAssetSource.archiveIndexSha256.localized,
            ),
          }),
        }
      : {};
    const { items: catalog } = z
      .object({
        kind: z.literal("scout-exact-inventory-assets"),
        build: z.literal(scene.identity.build),
        ...sourceIdentity,
        definitionsSha256: z.literal(
          "838c2828b0f8ae9e2380611691553ba67c163c7810bc0898a73807e1dca4d33c",
        ),
        localeSha256: z.literal(
          "9c252740f26c6825e446e42cd93f4be6afc90be89005e140c6c3161f5109046b",
        ),
        items: z.array(
          z.intersection(
            replayItemAssetSchema(z),
            z.object({
              iconSha256: z.string().regex(/^[0-9a-f]{64}$/),
            }),
          ),
        ),
      })
      .parse(JSON.parse(itemAssetBytes.toString("utf8")));
    const required = itemIdsForTracks(tracks);
    assert.equal(
      new Set(catalog.map(({ itemId }) => itemId)).size,
      catalog.length,
      "Duplicate exact replay item asset",
    );
    const items = [];
    for (const { itemId, icon, iconSha256, name, width, height } of catalog) {
      if (!required.delete(itemId)) continue;
      const image = await readFile(join(dirname(itemAssetsPath), icon));
      assert.equal(
        sha256(image),
        iconSha256,
        `Recorded item icon digest differs for ${itemId}`,
      );
      assert.deepEqual(
        inventoryIconDimensions(image),
        { width, height },
        `Recorded item icon dimensions differ for ${itemId}`,
      );
      itemRoutes.set(`/${icon}`, [image, "image/png"]);
      items.push({ itemId, name, icon, width, height });
    }
    assert.equal(
      required.size,
      0,
      "Exact inventory icons do not cover all recorded items",
    );
    if (decodeChampionInventory) scene.championInventoryItems = items;
    else scene.championInventory = { items, tracks };
  }
}
if (terrainControllerMaterialsPath !== undefined) {
  assert.ok(
    currentBuild && scene.workerMotion && replayCodecs && materialRoutes,
    "Replay-derived terrain visibility requires the current motion worker",
  );
  const { readExactMap11ControllerGraph, readExactMap11ControllerPackets } =
    await import("./extract-exact-map11-controller-inputs.mjs");
  const { deriveCurrentMap11ControllerVisibility } =
    await import("./research/native-terrain-controller-visibility.mjs");
  const graph = readExactMap11ControllerGraph(
    metadata,
    await readFile(terrainControllerMaterialsPath),
  );
  const receipt = deriveCurrentMap11ControllerVisibility({
    ...graph,
    ...readExactMap11ControllerPackets(replay),
    identity: {
      ...identity,
      geometrySha256: graph.geometrySha256,
      materialsSha256: graph.materialsSha256,
    },
    codecs: replayCodecs,
    durationSeconds: replay.duration,
  });
  validateRecordedTerrainVisibility(
    receipt,
    JSON.parse(metadata).meshes,
    replay.duration,
    { omitUnresolved: true },
  );
  scene.workerMotion.terrainControllerGraph = {
    ...graph,
    missingReplacementMeshControllerIds,
  };
}
if (
  decodeTeamVision ||
  inhibitorCatalog !== undefined ||
  turretCatalog !== undefined ||
  nexusCatalog !== undefined
) {
  assert.ok(currentBuild && scene.workerMotion && replayCodecs);
  let visionScene =
    replayWorldUnits === undefined
      ? scene
      : { ...scene, worldUnitModels: replayWorldUnits };
  let inhibitorValidator;
  let turretValidator;
  let nexusValidator;
  if (nexusCatalog !== undefined) {
    const { createCurrentReplayNexusCollector } =
      await import("./research/native-terrain-nexus-worker.mjs");
    nexusValidator = createCurrentReplayNexusCollector(
      prepared,
      nexusCatalog,
      replayCodecs,
    );
    visionScene = { ...visionScene, nexusModels: verifiedNexusModels };
  }
  if (turretCatalog !== undefined) {
    const { createCurrentReplayTurretCollector } =
      await import("./research/native-terrain-turret-worker.mjs");
    turretValidator = createCurrentReplayTurretCollector(
      prepared,
      turretCatalog,
    );
    visionScene = { ...visionScene, structureModels: verifiedTurretModels };
  }
  if (inhibitorCatalog !== undefined) {
    const { createCurrentReplayInhibitorCollector } =
      await import("./research/native-terrain-inhibitor-worker.mjs");
    inhibitorValidator = createCurrentReplayInhibitorCollector(
      prepared,
      inhibitorCatalog,
    );
    visionScene = {
      ...visionScene,
      inhibitorModels: { instances: inhibitorValidator.instances },
    };
  }
  function* validatedPackets() {
    for (const packet of replayTimedPacketEnvelopes(
      replayPacketEnvelopes(replay, decompress),
    )) {
      inhibitorValidator?.observe(packet);
      turretValidator?.observe(packet);
      nexusValidator?.observe(packet);
      yield packet;
    }
  }
  if (decodeTeamVision) {
    const { readCurrentRecordedTeamVision } =
      await import("./research/recorded-team-vision.mjs");
    readCurrentRecordedTeamVision(
      replay,
      visionScene,
      validatedPackets(),
      replayCodecs,
    );
    scene.workerMotion.decodeTeamVision = true;
  } else {
    for (const _ of validatedPackets()) {
      // Iterate the same preflight without collecting fog.
    }
  }
  inhibitorValidator?.finish();
  if (nexusValidator !== undefined)
    assert.deepEqual(
      (await nexusValidator.finish()).nexusModels,
      verifiedNexusModels,
      "Worker Nexus placements and terminal loss differ from independent prepared evidence",
    );
  if (turretValidator !== undefined) {
    const { structureModels, turretLosses } = turretValidator.finish();
    assert.deepEqual(
      structureModels,
      verifiedTurretModels,
      "Worker turret placements differ from independent prepared evidence",
    );
    assert.deepEqual(
      turretLosses,
      verifiedTurretLosses,
      "Worker turret losses differ from independent prepared evidence",
    );
  }
}
let championAnimationRoutes;
const animationScene =
  verifiedChampionModels === undefined
    ? scene
    : { ...scene, championModels: verifiedChampionModels };
if (animationCatalogPath !== undefined && decodeChampionModels) {
  const { readCurrentChampionAnimationModelCatalog } =
    await import("./research/recorded-champion-animation-resources.mjs");
  const { championAnimationModelCatalog, routes } =
    await readCurrentChampionAnimationModelCatalog(
      animationCatalogPath,
      animationCatalogDigest,
      {
        modelManifestPath: values["champion-models"],
        modelManifestSha256: values["champion-catalog-sha256"],
        identity,
      },
    );
  assert.ok(scene.workerMotion, "Champion animations require a motion worker");
  scene.workerMotion.championAnimationModelCatalog =
    championAnimationModelCatalog;
  championAnimationRoutes = routes;
} else if (animationCatalogPath !== undefined) {
  const { readCurrentChampionAnimationCatalog } =
    await import("./research/recorded-champion-animation-resources.mjs");
  const { bindings, routes } = await readCurrentChampionAnimationCatalog(
    animationCatalogPath,
    animationCatalogDigest,
    animationScene,
  );
  assert.ok(
    scene.workerMotion && bindings.length > 0,
    "Champion animation catalog requires a motion worker and at least one admitted model",
  );
  scene.workerMotion.championAnimationCatalog = bindings;
  championAnimationRoutes = routes;
} else if (animationPath !== undefined) {
  const { readRecordedChampionAnimations } =
    await import("./research/recorded-champion-animation-resources.mjs");
  const { cues, routes } = await readRecordedChampionAnimations(
    animationPath,
    animationDigest,
    animationScene,
    replay,
    decompress,
  );
  scene.championAnimationCues = cues;
  championAnimationRoutes = routes;
}
let announcerFiles;
if (announcerCatalogDirectory !== undefined) {
  const { readLocalAnnouncerCatalog } =
    await import("./local-announcer-preview.mjs");
  const { events, files } = await readLocalAnnouncerCatalog(
    announcerCatalogDirectory,
    identity,
  );
  assert.ok(scene.workerMotion, "Announcer catalog requires a motion worker");
  scene.workerMotion.announcerEvents = events;
  announcerFiles = files;
} else if (announcerDirectory !== undefined) {
  const { readLocalAnnouncerPreview } =
    await import("./local-announcer-preview.mjs");
  announcerFiles = await readLocalAnnouncerPreview(
    announcerDirectory,
    prepared.packetReader,
    identity,
  );
}
const source = (name) =>
  Bun.file(new URL(`./research/${name}`, import.meta.url));
const particleManifest = values["recorded-particles"];
const particleDigest = values["recorded-particles-sha256"];
assert.ok(
  (particleManifest === undefined && particleDigest === undefined) ||
    (particleManifest !== undefined &&
      particleDigest !== undefined &&
      privatePackageOutput !== undefined &&
      currentBuild),
  "Recorded particles require a pinned manifest and the private current package",
);
const routes = new Map([
  ["/", [source("native-terrain.html"), "text/html; charset=utf-8"]],
  [
    "/terrain.mjs",
    [source("native-terrain-page.mjs"), "text/javascript; charset=utf-8"],
  ],
  [
    "/terrain-renderer.mjs",
    [source("native-terrain.mjs"), "text/javascript; charset=utf-8"],
  ],
  [
    "/native-terrain-actors.mjs",
    [source("native-terrain-actors.mjs"), "text/javascript; charset=utf-8"],
  ],
  [
    "/native-terrain-overhead.mjs",
    [source("native-terrain-overhead.mjs"), "text/javascript; charset=utf-8"],
  ],
  [
    "/native-terrain-recorded-particles.mjs",
    [
      source("native-terrain-recorded-particles.mjs"),
      "text/javascript; charset=utf-8",
    ],
  ],
  ["/three.core.js", [Bun.file(threeCore), "text/javascript; charset=utf-8"]],
  ["/map.json", [metadata, "application/json"]],
  ["/map.bin", [mesh, "application/octet-stream"]],
  ["/scene.json", [JSON.stringify(scene), "application/json"]],
]);
if (navgridBytes !== undefined) {
  routes.set("/heights.bin", [navgridBytes, "application/octet-stream"]);
  routes.set("/minimap.png", [await readPinned("topography.png"), "image/png"]);
}
if (materialRoutes !== undefined) {
  for (const [path, response] of materialRoutes) routes.set(path, response);
}
if (championModelRoutes !== undefined) {
  for (const [path, response] of championModelRoutes)
    routes.set(path, response);
}
for (const [path, response] of championAnimationRoutes ?? [])
  routes.set(path, response);
if (structureModelRoutes !== undefined) {
  for (const [path, response] of structureModelRoutes)
    routes.set(path, response);
}
if (nexusModelRoutes !== undefined) {
  for (const [path, response] of nexusModelRoutes) routes.set(path, response);
}
for (const [path, response] of inhibitorModelRoutes ?? [])
  routes.set(path, response);
for (const [path, response] of worldUnitModelRoutes) routes.set(path, response);
for (const [path, response] of itemRoutes) routes.set(path, response);
if (motionWorker !== undefined) {
  routes.set("/replay-motion-worker.mjs", [
    motionWorker.script,
    "text/javascript; charset=utf-8",
  ]);
  routes.set("/replay-motion.rofl", [bytes, "application/octet-stream"]);
  routes.set("/replay-motion-decoder.bin", [
    motionWorker.decoderBytes,
    "application/octet-stream",
  ]);
}
assert.ok(await Bun.file(threeCore).exists(), "Missing local Three.js vendor");
if (privatePackageOutput !== undefined) {
  const { readLocalRecordedParticles, writeLocalScoutTerrainPackage } =
    await import("./build-local-scout-terrain-package.mjs");
  const particleFiles =
    particleManifest === undefined
      ? undefined
      : await readLocalRecordedParticles(
          particleManifest,
          particleDigest,
          identity,
        );
  const result = await writeLocalScoutTerrainPackage({
    output: privatePackageOutput,
    identity,
    routes,
    threeCore,
    announcerFiles,
    particleFiles,
  });
  console.log(JSON.stringify(result));
  process.exit(0);
}
if (values["scout-css"] !== undefined) {
  const css = Bun.file(values["scout-css"]);
  assert.ok(await css.exists(), "Missing local Scout stylesheet");
  const appRoot = fileURLToPath(
    new URL(
      "../../../../../packages/scout-for-lol/packages/app/",
      import.meta.url,
    ),
  );
  const bundle = await Bun.build({
    entrypoints: [
      fileURLToPath(new URL("../scout-terrain-demo.tsx", import.meta.url)),
    ],
    target: "browser",
    format: "esm",
    plugins: [
      {
        name: "scout-terrain-workspace-dependencies",
        setup(build) {
          build.onResolve(
            {
              filter:
                /^(?:react(?:\/.*)?|react-dom(?:\/.*)?|zod(?:\/.*)?|@scout-for-lol\/.*)$/,
            },
            (args) => ({ path: Bun.resolveSync(args.path, appRoot) }),
          );
        },
      },
    ],
  });
  if (!bundle.success || bundle.outputs.length !== 1)
    throw new AggregateError(
      bundle.logs,
      "Scout terrain browser bundle failed",
    );
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scout terrain replay</title><link rel="stylesheet" href="/scout-demo.css"></head><body><div id="root"></div><script type="module" src="/scout-terrain.js"></script></body></html>`;
  routes.set("/scout", [html, "text/html; charset=utf-8"]);
  routes.set("/scout-terrain.js", [
    bundle.outputs[0],
    "text/javascript; charset=utf-8",
  ]);
  routes.set("/scout-demo.css", [css, "text/css; charset=utf-8"]);
}
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const url = new URL(request.url);
    if (url.host !== `127.0.0.1:${server.port}`)
      return new Response(null, { status: 403 });
    if (rawReplayOnly && url.pathname === "/")
      return new Response(null, {
        status: 302,
        headers: { Location: "/scout" },
      });
    const route = routes.get(url.pathname);
    if (!route) return new Response(null, { status: 404 });
    if (
      (url.pathname.startsWith("/replay-motion") ||
        url.pathname.startsWith("/champion-models/") ||
        url.pathname.startsWith("/structure-models/") ||
        url.pathname.startsWith("/nexus-models/") ||
        url.pathname.startsWith("/inhibitor-models/") ||
        url.pathname.startsWith("/world-unit-models/")) &&
      request.headers.get("Sec-Fetch-Site") === "cross-site"
    )
      return new Response(null, { status: 403 });
    return new Response(route[0], {
      headers: {
        "Content-Type": route[1],
        "Cache-Control":
          url.pathname.startsWith("/map-textures/") ||
          url.pathname.startsWith("/champion-models/") ||
          url.pathname.startsWith("/structure-models/") ||
          url.pathname.startsWith("/nexus-models/") ||
          url.pathname.startsWith("/inhibitor-models/") ||
          url.pathname.startsWith("/world-unit-models/")
            ? "private, max-age=31536000, immutable"
            : "no-store",
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
        ...(url.pathname === "/replay-motion-worker.mjs"
          ? {
              "Content-Security-Policy":
                "default-src 'none'; connect-src 'none'",
            }
          : {}),
      },
    });
  },
});
console.log(server.url.href);
