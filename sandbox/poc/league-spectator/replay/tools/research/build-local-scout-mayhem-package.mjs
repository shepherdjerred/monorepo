import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { openReplay } from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/transport.mjs";
import { writeLocalScoutTerrainPackage } from "../build-local-scout-terrain-package.mjs";
import {
  mayhemFlowMapAsset,
  mayhemFlowMapControlSha256,
} from "./mayhem-flowmap-control-contract.mjs";
import { readRecordedMayhemExperienceThresholds } from "./recorded-champion-experience.mjs";

const map = { mapId: 12, gameMode: "KIWI", mayhemMapSkin: "Bloom" };
const build = "16.23.841.8428";
const protocol = "8bbfcd5af2bc92db";
const sha256 = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

const bloomMaterialsSha256 =
  "edda022b5e925b62ccf05430623e339873cb06a67e7a6ef02764a5a3552f683b";
const bloomMaterialPath =
  "Maps/KitPieces/Howling_Abyss/Bloom/Materials/Default/";
const twilightCanopyTexture =
  "d2790f312b3727d7b810bd79c338f45f98f6593d095d159a2c2b95707c64a5c3";
// These four materials use the authored normal-pass foliage shader
// {8b183f26}, with source alpha / one minus source alpha and no alpha test.
const blendedCanopyTextures = {
  Bloom_Foliage_Kinkou_Canopy_MAT_Shader:
    "4445406cbe0ed90257663fa394e737ab41708d674d03d21eec9b8c069be9d0ef",
  Bloom_Foliage_Twilight_Canopy_MAT_Shader: twilightCanopyTexture,
  Bloom_Foliage_Twilight_Canopy_FloatingB_MAT_Shader: twilightCanopyTexture,
  Bloom_Foliage_Twilight_Canopy_FloatingD_MAT_Shader: twilightCanopyTexture,
};

async function readPinned({ path, sha256: expected }) {
  assert.match(expected, /^[a-f0-9]{64}$/u, "Expected SHA-256 input pin");
  const bytes = await Bun.file(path).bytes();
  assert.equal(sha256(bytes), expected, `Digest differs for ${path}`);
  return bytes;
}

async function readReceipt(input) {
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(await readPinned(input)),
  );
}

function assertMatchIdentity(row, replaySha256) {
  assert.equal(row.build, build);
  assert.equal(row.protocol, protocol);
  assert.equal(row.replaySha256, replaySha256);
}

async function buildPackage(inputs) {
  const [terrain, startup, equipped, catalog, replayBytes] = await Promise.all([
    readReceipt(inputs.terrain),
    readReceipt(inputs.startup),
    readReceipt(inputs.equipped),
    readReceipt(inputs.catalog),
    readPinned(inputs.replay),
  ]);
  assert.equal(startup.malformedControls, true);
  assert.equal(startup.replays.length, 1);
  const [recorded] = startup.replays;
  for (const receipt of [terrain, recorded, equipped])
    assertMatchIdentity(receipt, inputs.replay.sha256);
  for (const { configuredMapId, mode, configurationMapSkin } of [
    terrain,
    recorded,
  ])
    assert.deepEqual(
      [configuredMapId, mode, configurationMapSkin],
      [map.mapId, map.gameMode, map.mayhemMapSkin],
    );
  assert.equal(catalog.kind, "exact-native-terrain-champion-catalog");
  assert.equal(catalog.selectionKind, "archive");
  assert.equal(catalog.build, build);
  assert.equal(catalog.protocol, protocol);
  assert.equal(equipped.decoderSha256, inputs.decoder.sha256);
  assert.equal(equipped.rows.length, 10);

  const replay = openReplay(
    replayBytes.buffer.slice(
      replayBytes.byteOffset,
      replayBytes.byteOffset + replayBytes.byteLength,
    ),
  );
  assert.equal(replay.build, build);
  assert.equal(replay.protocol, protocol);
  assert.equal(replay.roster.length, 10);
  const identity = {
    build,
    protocol,
    durationMilliseconds: replay.durationMilliseconds,
    participantCount: replay.roster.length,
    replaySha256: inputs.replay.sha256,
    mayhemMapSkin: map.mayhemMapSkin,
  };

  const routes = new Map();
  const terrainRoot = dirname(inputs.terrain.path);
  const terrainResource = (name) => ({
    path: join(terrainRoot, name),
    sha256: terrain.files[name].sha256,
  });
  const add = async (route, input) => {
    if (!routes.has(route)) routes.set(route, [await readPinned(input)]);
  };
  for (const file of ["map.json", "map.bin", "heights.bin"])
    await add("/" + file, terrainResource("geometry/" + file));
  await add("/minimap.png", inputs.minimap);
  await add("/replay-motion-decoder.bin", inputs.decoder);
  await add("/replay-motion-worker.mjs", inputs.worker);
  await readPinned(inputs.three);

  const assets = {};
  const participants = [];
  const participantIds = new Set();
  for (const [index, row] of equipped.rows.entries()) {
    const { champion, team } = replay.roster[index];
    const {
      champion: catalogChampion,
      skinId,
      skinScale,
      hiddenRanges,
      model,
    } = catalog.assets[row.key];
    assert.equal(row.champion.toLowerCase(), champion.toLowerCase());
    assert.equal(catalogChampion.toLowerCase(), champion.toLowerCase());
    assert.equal(row.skinId, skinId);
    assert.equal(row.key, `${champion.toLowerCase()}-${skinId}`);
    assert.equal(model.file, `${row.key}/model.glb`);
    assert.equal(model.sha256, row.modelSha256);
    assert.ok(
      !participantIds.has(row.context) && assets[row.key] === undefined,
    );
    participantIds.add(row.context);
    assets[row.key] = { champion, skinId, skinScale, hiddenRanges, model };
    participants.push({
      participantId: row.context,
      name: champion,
      championName: champion,
      teamId: team,
    });
    await add("/champion-models/" + model.sha256 + ".glb", {
      path: join(dirname(inputs.catalog.path), model.file),
      sha256: model.sha256,
    });
  }

  const geometry = await readReceipt(terrainResource("geometry/map.json"));
  const materials = await readReceipt(
    terrainResource("materials/materials.json"),
  );
  assert.deepEqual(materials.coverage, terrain.coverage);
  assert.equal(materials.source.materialsSha256, bloomMaterialsSha256);
  const blendedCanopies = new Map(
    Object.entries(blendedCanopyTextures).map(([name, texture]) => [
      bloomMaterialPath + name,
      texture,
    ]),
  );
  for (const [name, texture] of blendedCanopies) {
    const binding = materials.bindings[name];
    assert.equal(binding?.sha256, texture, `Wrong diffuse texture for ${name}`);
    assert.equal(binding.alphaTest, 0, `Unexpected alpha cutoff for ${name}`);
  }
  const bindings = [];
  for (const [material, binding] of Object.entries(materials.bindings)) {
    const { sha256: textureDigest, alphaTest, width, height } = binding;
    const path = `textures/${textureDigest}.png`;
    assert.equal(binding.path, path);
    const input = terrainResource("materials/" + path);
    assert.equal(input.sha256, textureDigest);
    const url = `/map-textures/${textureDigest}.png`;
    await add(url, input);
    bindings.push({
      material,
      url,
      alphaTest,
      width,
      height,
      ...(blendedCanopies.has(material) ? { sourceAlphaBlend: true } : {}),
    });
  }

  const { min, max, x, z, step, movementOrigin } = terrain.navigation;
  const thresholds =
    inputs.experienceMap === undefined
      ? undefined
      : readRecordedMayhemExperienceThresholds(
          await readPinned(inputs.experienceMap),
        );
  let mayhemFlowMapControl;
  if (inputs.flowMapControl !== undefined) {
    const file = inputs.flowMapControl;
    assert.equal(file.sha256, mayhemFlowMapControlSha256);
    const controlBytes = await readPinned(file);
    const control = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(controlBytes),
    );
    assert.equal(
      control.source.geometrySha256,
      materials.source.geometrySha256,
    );
    assert.equal(
      control.source.materialsSha256,
      materials.source.materialsSha256,
    );
    const prefix = "/flowmap-control/";
    routes.set(prefix + "manifest.json", [controlBytes]);
    for (const [asset, record] of Object.entries(control.contents)) {
      assert.match(asset, mayhemFlowMapAsset);
      await add(prefix + asset, {
        path: join(dirname(file.path), asset),
        sha256: record.sha256,
      });
    }
    mayhemFlowMapControl = file.sha256;
  }
  const scene = {
    identity,
    mapBounds: { min, max },
    staticMesh: {
      exportedMeshes: geometry.meshes.length,
      sourceMeshCount: geometry.sourceMeshCount,
      meshTriangles: materials.coverage.totalTriangles,
    },
    participants,
    frames: [],
    terrainMaterials: {
      texturedTriangles: materials.coverage.texturedTriangles,
      bindings,
    },
    navgrid: { columns: x, rows: z, step },
    minimap: true,
    ...(mayhemFlowMapControl === undefined ? {} : { mayhemFlowMapControl }),
    ...(thresholds === undefined
      ? {}
      : { championExperienceThresholds: thresholds }),
    workerMotion: {
      waypointOrigin: movementOrigin,
      allowCurrentBuild: true,
      decodeChampionStats: true,
      decodePlayerState: true,
      ...(thresholds === undefined ? {} : { decodeChampionExperience: true }),
      championModelCatalog: {
        schema: catalog.schema,
        kind: catalog.kind,
        build,
        protocol,
        selectionKind: catalog.selectionKind,
        assets,
      },
    },
  };
  routes.set("/scene.json", [JSON.stringify(scene)]);
  return writeLocalScoutTerrainPackage({
    output: inputs.output,
    identity,
    map,
    routes,
    threeCore: inputs.three.path,
  });
}

if (import.meta.main) {
  const [inputPath, ...extra] = Bun.argv.slice(2);
  assert.ok(
    inputPath && extra.length === 0,
    "Supply a private Mayhem input JSON path",
  );
  console.log(
    JSON.stringify(await buildPackage(await Bun.file(inputPath).json())),
  );
}
