import * as THREE from "three";
import { GLTFLoader } from "/assets/vendor/GLTFLoader.js";
import { OrbitControls } from "/assets/vendor/OrbitControls.js";
import { indexMovement, sampleMovement } from "./playback.mjs";
import {
  createAnimationGraph,
  readAnimationAsset,
} from "./latest-animation.mjs";
import { createLatestAnimationPoses } from "./latest-animation-poses.mjs";
import { loadLatestViewerPoseAssets } from "./latest-viewer-pose-assets.mjs";
import {
  loadLatestStaticCatalogSelection,
  assertLatestStaticCatalogSelection,
} from "./latest-static-catalog.mjs";
import { applyLatestViewerPoseLayer } from "./latest-viewer-pose-sampler.mjs";
import {
  createLatestSubmeshVisibility,
  bindSubmeshVisibilityNodes,
} from "./latest-submesh-visibility.mjs";
import { resolveCombatPresentation } from "./latest-combat.mjs";
import { prepareLatestMovement } from "./latest-movement.mjs";
import { bindLatestBuildings, bindLatestMinions } from "./latest-world.mjs";
import {
  analyzeLatestMissiles,
  createLatestMissileMotion,
} from "./latest-missiles.mjs";
import { sha256 } from "./structural-comparison.mjs";
import { bindLatestMissileEffects } from "./latest-effects.mjs";
import { createLatestTerrain } from "./latest-terrain.mjs";
import { createLatestWorldPresentation } from "./latest-world-presentation.mjs";
import { createLatestMissileControllers } from "./latest-missile-controllers.mjs";
import { createLatestMissileInitialization } from "./latest-missile-initialization.mjs";
import { createLatestMissileFrame } from "./latest-missile-frame.mjs";
import { createLatestMissileActors } from "./latest-missile-actors.mjs";
import { createLatestVfxValues } from "./latest-vfx-values.mjs";
import { buildLatestMissilePlayback } from "./latest-missile-playback.mjs";
import { LatestPreparedEffectPlayback } from "./latest-prepared-effect-playback.mjs";
import { createLatestDirectEffectSession } from "./latest-direct-effect-session.mjs";
import {
  LatestDirectReplyLoop,
  LatestDesiredReplayClock,
} from "./latest-direct-reply-loop.mjs";
import { LatestSpectatorDiagnostics } from "./latest-spectator-diagnostics.mjs";
import {
  LatestDirectCaptureOwnership,
  applyViewerFollowTranslation,
  sampleViewerFollowPosition,
  captureSynchronizedDirectView,
  restoreViewerMinionBindPreview,
  LatestOwnedFollowCameraUpdate,
} from "./latest-viewer-frame-coordination.mjs";
import { DIRECT_EFFECT_PROGRAM_VERSION } from "./latest-direct-effect-runtime.mjs";
import { LatestGpuTimings } from "./latest-gpu-timings.mjs";
import { beginDirectDrawCapture } from "./latest-direct-draw-diagnostics.mjs";
import { createLatestEffectPipeline } from "./latest-effect-pipeline.mjs";
import { loadLatestSelectedMaterialRegistry } from "./latest-selected-materials.mjs";
import {
  createLatestEffectContexts,
  summarizeEffectContextRequests,
} from "./latest-effect-contexts.mjs";
import { createLatestEffectResolvers } from "./latest-effect-resolvers.mjs";
import { createLatestReplayState } from "./latest-replay-state.mjs";
import { LatestViewerReplayLoad } from "./latest-viewer-replay-load.mjs";
import { createLatestItemAssets } from "./latest-item-assets.mjs";
import {
  createLatestCorpsePolicy,
  createLatestMinionCorpsePlayback,
} from "./latest-corpse.mjs";
import {
  createLatestInspection,
  inspectionPanelDrawing,
  paintInspectionPanel,
  pickVisibleReplayEntity,
} from "./latest-inspection.mjs";
import { primaryResourcePresentation } from "./latest-champion-state.mjs";
import {
  championPlateDrawing,
  paintChampionPlate,
  unitPlateDrawing,
} from "./latest-overhead.mjs";
import {
  prepareLatestLifecycle,
  sampleLatestLifecycle,
  movementFollowsRespawn,
  sampleLatestDeathPosePreview,
} from "./latest-lifecycle.mjs";

const $ = (id) => document.getElementById(id),
  root = "/assets/latest-scene",
  poseRoot = "/assets/latest-animation-poses";
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x122535);
const renderer = new THREE.WebGLRenderer({
  canvas: $("scene"),
  antialias: true,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
  const logs = [
    gl.getProgramInfoLog(program),
    gl.getShaderInfoLog(vertex),
    gl.getShaderInfoLog(fragment),
  ].filter(Boolean);
  throw Error(`Replay WebGL shader failed: ${logs.join("\n")}`);
};
const camera = new THREE.PerspectiveCamera(42, 1, 5, 60000),
  controls = new OrbitControls(camera, $("scene"));
const preparedEffects = new LatestPreparedEffectPlayback();
const replayLoad = new LatestViewerReplayLoad();
let preparingEffectPreview = false,
  effectPreviewJob = 0,
  preparedPlaybackClock = null,
  effectLookahead = null,
  cameraInteracting = false;
const presentedCamera = camera.clone();
controls.enableDamping = true;
controls.minDistance = 300;
controls.maxDistance = 26000;
controls.maxPolarAngle = Math.PI * 0.48;
const world = new THREE.Group();
world.scale.z = -1;
scene.add(world);
let manifest,
  staticCatalog = null,
  sceneManifestBytes,
  worldCatalog,
  corpsePolicy,
  minionCorpses = null,
  animationPoses,
  viewerProfile,
  viewerPoseAssets = null,
  submeshVisibility,
  missileMotionDefinition,
  missileControllers,
  missileInitialization,
  missileFrame,
  missileActors,
  vfxValues,
  vfxRenderer = null,
  effectPipeline = null,
  directEffectInputs = null,
  directEffectSession = null,
  directEffectPending = null,
  effectContexts,
  effectResolvers,
  effectManifest,
  effectManifestBytes,
  terrain,
  report,
  replayState,
  inspection = null,
  inspectionKey = null,
  inspectionDrawing = null,
  itemAssets = null,
  tracks,
  time = 0,
  presentedTime = 0,
  playing = false,
  speed = 1,
  follow = null,
  worker = null;
let spectatorRecording = null,
  spectatorGpuTimings = null,
  spectatorLongTasks = null,
  diagnosticFrame = null,
  worldUpdateAndHudMs = 0,
  effectCommitMs = 0;
let directReplyLoop = null,
  directReplayClock = null,
  replySession = null,
  replyReport = null,
  drawSerial = 0,
  lastDrawStamp = null,
  cameraIntentVersion = 0,
  knownCameraIntentKey = null;
const directCaptureOwnership = new LatestDirectCaptureOwnership();
const ownedFollowCameraUpdate = new LatestOwnedFollowCameraUpdate();
const heroes = [],
  buildings = [],
  minions = [],
  loader = new GLTFLoader(),
  textureLoader = new THREE.TextureLoader();
const itemImages = new Map();
async function loadInspectionItems(load) {
  itemAssets = await replayLoad.wait(
    load,
    createLatestItemAssets(
      report,
      await replayLoad.wait(
        load,
        get("/assets/latest-items/package.json", true),
      ),
    ),
  );
  const ids = new Set(
    report.inventoryEvents.flatMap((e) =>
      e.entries.filter((f) => f.count > 0 && f.itemId).map((f) => f.itemId),
    ),
  );
  const assets = new Map(
    [...ids].map((id) => {
      const asset = itemAssets.get(id);
      return [asset.iconSha256, asset];
    }),
  );
  await Promise.all(
    [...assets.values()].map(async (asset) => {
      const bytes = await replayLoad.wait(
        load,
        get(`/assets/latest-items/${asset.icon}`, true),
      );
      if ((await replayLoad.wait(load, sha256(bytes))) !== asset.iconSha256)
        throw Error("Installed item icon changed");
      const image = await createImageBitmap(
        new Blob([bytes], { type: "image/png" }),
      );
      if (!replayLoad.isCurrent(load)) image.close();
      replayLoad.assertCurrent(load);
      itemImages.set(asset.iconSha256, image);
    }),
  );
}
let animationTracks = new Map();
let lifecycleTracks = new Map();
let actorWorldPresentation = null;
const vectorA = new THREE.Vector3(),
  vectorB = new THREE.Vector3(),
  quaternionA = new THREE.Quaternion(),
  quaternionB = new THREE.Quaternion();
const fmt = (t) =>
  `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
function updateInspection() {
  const canvas = $("unit-panel"),
    model = replayLoad.loading
      ? null
      : (inspection?.sample(presentedTime) ?? null),
    more = $("unit-more-stats");
  canvas.hidden = model === null;
  more.hidden = model?.combatStatsStatus !== "observed";
  if (!model) {
    inspectionKey = null;
    inspectionDrawing = null;
    return;
  }
  const key = JSON.stringify({
    ...model,
    time: Math.floor(model.time * 10) / 10,
  });
  if (key === inspectionKey) return;
  const drawing = inspectionPanelDrawing(model);
  if (canvas.width !== drawing.width) canvas.width = drawing.width;
  if (canvas.height !== drawing.height) canvas.height = drawing.height;
  const context = canvas.getContext("2d");
  if (!context) throw Error("Inspection canvas unavailable");
  paintInspectionPanel(context, drawing, itemImages);
  $("unit-more-stat-values").textContent = model.additionalCombatStats
    .map((row) => `${row.label}: ${row.formatted}`)
    .join("\n");
  inspectionDrawing = drawing;
  canvas.title = "";
  canvas.setAttribute("aria-label", drawing.description);
  inspectionKey = key;
}
$("unit-panel").addEventListener("pointermove", (event) => {
  const canvas = $("unit-panel"),
    bounds = canvas.getBoundingClientRect(),
    x = ((event.clientX - bounds.left) * canvas.width) / bounds.width,
    y = ((event.clientY - bounds.top) * canvas.height) / bounds.height,
    region = inspectionDrawing?.itemRegions.find(
      (r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h,
    );
  canvas.title = region?.label ?? "";
});
function selectEntity(entityId) {
  if (replayLoad.loading) return;
  if (!inspection) throw Error("Replay inspection is not ready");
  if (entityId === null) inspection.clear();
  else inspection.select(entityId);
  updateInspection();
}
let selectionPointer = null;
$("scene").addEventListener("pointerdown", (e) => {
  selectionPointer =
    e.button === 0 && e.isPrimary
      ? { id: e.pointerId, x: e.clientX, y: e.clientY }
      : null;
});
$("scene").addEventListener("pointercancel", () => {
  selectionPointer = null;
});
$("scene").addEventListener("pointerup", (e) => {
  const start = selectionPointer;
  selectionPointer = null;
  if (
    replayLoad.loading ||
    !inspection ||
    !start ||
    start.id !== e.pointerId ||
    Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4
  )
    return;
  try {
    const bounds = renderer.domElement.getBoundingClientRect(),
      raycaster = new THREE.Raycaster(),
      actors = [...heroes, ...buildings, ...minions],
      ids = new Set(actors.map((a) => a.hero?.entityId ?? a.event.entityId));
    world.updateMatrixWorld(true);
    presentedCamera.updateMatrixWorld();
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - bounds.left) / bounds.width) * 2 - 1,
        (-(e.clientY - bounds.top) / bounds.height) * 2 + 1,
      ),
      presentedCamera,
    );
    selectEntity(
      pickVisibleReplayEntity(
        raycaster.intersectObjects(
          actors.map((a) => a.group),
          true,
        ),
        ids,
      ),
    );
  } catch (error) {
    fail(error);
  }
});
async function rawGet(path, bytes = false) {
  const response = await fetch(path);
  if (!response.ok) throw Error(`HTTP ${response.status}: ${path}`);
  return bytes ? response.arrayBuffer() : response.json();
}
async function get(path, bytes = false) {
  if (staticCatalog === null) return rawGet(path, bytes);
  if (typeof path !== "string" || !path.startsWith("/assets/"))
    throw Error("Selected viewer requires an owned static asset path");
  const relative = path.slice("/assets/".length),
    data =
      relative === "decoder-16.21-macos/profile.json"
        ? staticCatalog.readProfile()
        : await staticCatalog.read(relative);
  return bytes
    ? data.buffer
    : JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
}
async function selectedStaticRoot() {
  return loadLatestStaticCatalogSelection({
    load: async (path) => new Uint8Array(await rawGet(`/assets/${path}`, true)),
  });
}
function fail(error) {
  replayLoad.invalidate();
  if (vfxRenderer === directEffectSession?.renderer) vfxRenderer = null;
  directReplyLoop?.close();
  directReplyLoop = null;
  directReplayClock = null;
  lastDrawStamp = null;
  knownCameraIntentKey = null;
  ownedFollowCameraUpdate.clear();
  directEffectSession?.close();
  directEffectSession = null;
  directEffectInputs = null;
  directEffectPending = null;
  cancelPreparedEffectPreview();
  effectLookahead?.invalidate();
  effectLookahead = null;
  vfxRenderer?.dispose();
  vfxRenderer = null;
  effectPipeline = null;
  playing = false;
  worker?.terminate();
  worker = null;
  report = null;
  presentedTime = 0;
  inspection = null;
  updateInspection();
  $("action-jump").disabled = true;
  $("attack-jump").disabled = true;
  $("motion-jump").disabled = true;
  $("world-jump").disabled = true;
  $("death-jump").disabled = true;
  $("missile-jump").disabled = true;
  $("smooth-effect").disabled = true;
  $("minion-jump").disabled = true;
  $("minion-attack-jump").disabled = true;
  $("play").disabled = true;
  $("seek").disabled = true;
  $("play").textContent = "Play";
  $("status").textContent = "Research view stopped";
  $("error").textContent = String(error);
  console.error(error);
  $("load").disabled = false;
  $("file").disabled = false;
}
function overview() {
  cancelPreparedEffectPreview();
  effectLookahead?.invalidate();
  follow = null;
  const center = manifest?.map.movementOrigin ?? [6581, 6241];
  controls.target.set(center[0], -150, -center[1]);
  camera.position.set(center[0], 15000, center[1] * -0.1);
  controls.update();
  $("camera-status").textContent =
    "Full map · drag to orbit, right drag to pan, scroll to zoom";
}
$("overview").onclick = overview;
overview();
new ResizeObserver(() => {
  const b = $("viewport").getBoundingClientRect();
  renderer.setSize(b.width, b.height, false);
  camera.aspect = b.width / b.height;
  camera.updateProjectionMatrix();
  effectLookahead?.invalidate();
  cancelPreparedEffectPreview("Window changed · prepare the sequence again.");
}).observe($("viewport"));
function height(x, z) {
  return terrain.height(x, z);
}
async function loadMap(selection = null) {
  if (selection !== null) assertLatestStaticCatalogSelection(selection);
  staticCatalog = selection;
  const sceneBytes = await get(`${root}/manifest.json`, true);
  sceneManifestBytes = sceneBytes.slice(0);
  manifest = JSON.parse(new TextDecoder().decode(sceneBytes));
  if (
    manifest.build !== "16.21.829.8620" ||
    manifest.protocol !== "20e09df23c66b85e"
  )
    throw Error("Wrong static asset package");
  const [
    description,
    buffer,
    bindingData,
    heightBytes,
    profile,
    motionBytes,
    controllerBytes,
    actorBytes,
    valueBytes,
    effects,
    clockBytes,
    poseManifestBytes,
    visibilityBytes,
    corpseBytes,
    worldBytes,
    effectContextBytes,
    effectResolverBytes,
    builtinContextBytes,
  ] = await Promise.all([
    get(`${root}/map/map.json`),
    get(`${root}/map/map.bin`, true),
    get(`${root}/map/bindings.json`),
    get(`${root}/heights.bin`, true),
    get("/assets/decoder-16.21-macos/profile.json"),
    get("/assets/decoder-16.21-macos/missile-motion.json", true),
    get("/assets/decoder-16.21-macos/missile-controllers.json", true),
    get("/assets/decoder-16.21-macos/missile-actors.json", true),
    get("/assets/decoder-16.21-macos/vfx-values.json", true),
    get("/assets/latest-effects/manifest.json", true),
    get("/assets/decoder-16.21-macos/animation-clock.json", true),
    get(`${poseRoot}/manifest.json`, true),
    get("/assets/latest-submesh-visibility/package.json", true),
    get("/assets/latest-corpse/package.json", true),
    get(`${root}/${manifest.world}`, true),
    get("/assets/latest-effect-contexts/package.json", true),
    get("/assets/latest-effect-resolvers/package.json", true),
    get("/assets/latest-builtin-resource-contexts/package.json", true),
  ]);
  corpsePolicy = await createLatestCorpsePolicy(
    profile,
    sceneBytes,
    worldBytes,
    corpseBytes,
    staticCatalog,
  );
  worldCatalog = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(worldBytes),
  );
  effectManifestBytes = effects;
  effectContexts = await createLatestEffectContexts({
    profile,
    packageBytes: effectContextBytes,
    effectsManifestBytes: effects,
    staticCatalog,
  });
  effectResolvers = await createLatestEffectResolvers({
    profile,
    builtinContextPackageBytes: builtinContextBytes,
    packageBytes: effectResolverBytes,
    effectsManifestBytes: effects,
    contexts: effectContexts,
    staticCatalog,
  });
  submeshVisibility = await createLatestSubmeshVisibility(
    profile,
    sceneBytes,
    visibilityBytes,
    staticCatalog,
  );
  animationPoses = await createLatestAnimationPoses(
    profile,
    clockBytes,
    poseManifestBytes,
  );
  viewerProfile = profile;
  effectManifest = JSON.parse(new TextDecoder().decode(effects));
  if (
    effectManifest.build !== manifest.build ||
    effectManifest.protocol !== manifest.protocol ||
    effectManifest.sceneManifestSha256 !== (await sha256(sceneBytes))
  )
    throw Error("Effect assets differ from the static scene build");
  missileMotionDefinition = JSON.parse(new TextDecoder().decode(motionBytes));
  const controllerDefinition = JSON.parse(
    new TextDecoder().decode(controllerBytes),
  );
  const actorDefinition = JSON.parse(new TextDecoder().decode(actorBytes));
  const valueDefinition = JSON.parse(new TextDecoder().decode(valueBytes));
  if (
    profile.clientVersion !== manifest.build ||
    profile.protocolDigest !== manifest.protocol ||
    (await sha256(motionBytes)) !== profile.missileMotionSha256 ||
    missileMotionDefinition.decoderImageSha256 !== profile.decoderImageSha256 ||
    (await sha256(controllerBytes)) !== profile.missileControllersSha256 ||
    controllerDefinition.decoderImageSha256 !== profile.decoderImageSha256 ||
    (await sha256(actorBytes)) !== profile.missileActorsSha256 ||
    actorDefinition.decoderImageSha256 !== profile.decoderImageSha256 ||
    (await sha256(valueBytes)) !== profile.vfxValuesSha256 ||
    valueDefinition.decoderImageSha256 !== profile.decoderImageSha256
  )
    throw Error("Missile motion package integrity/build mismatch");
  createLatestMissileMotion(missileMotionDefinition);
  missileControllers = createLatestMissileControllers(controllerDefinition);
  missileInitialization =
    createLatestMissileInitialization(controllerDefinition);
  missileActors = createLatestMissileActors(actorDefinition);
  vfxValues = createLatestVfxValues(valueDefinition);
  terrain = createLatestTerrain(manifest, new Float32Array(heightBytes));
  missileFrame = createLatestMissileFrame(
    controllerDefinition,
    createLatestMissileMotion(missileMotionDefinition),
    missileControllers,
    terrain,
  );
  const textures = new Map(),
    materials = new Map();
  await Promise.all(
    Object.entries(bindingData.bindings).map(async ([name, binding]) => {
      if (!textures.has(binding.texture))
        textures.set(
          binding.texture,
          textureLoader.loadAsync(`${root}/map/${binding.texture}`),
        );
      const texture = await textures.get(binding.texture);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      materials.set(
        name,
        new THREE.MeshBasicMaterial({
          map: texture,
          side: THREE.DoubleSide,
          alphaTest: binding.alphaTest,
        }),
      );
    }),
  );
  let rendered = 0,
    omitted = 0;
  for (const item of description.meshes) {
    const subs = item.submeshes.filter(
      (s) => !Object.hasOwn(bindingData.unsupported, s.material),
    );
    omitted += item.submeshes.length - subs.length;
    if (!subs.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array(buffer, item.positionOffset, item.vertexCount * 3),
        3,
      ),
    );
    if (item.hasUv)
      geometry.setAttribute(
        "uv",
        new THREE.BufferAttribute(
          new Float32Array(buffer, item.uvOffset, item.vertexCount * 2),
          2,
        ),
      );
    geometry.setIndex(
      new THREE.BufferAttribute(
        new Uint32Array(buffer, item.indexOffset, item.indexCount),
        1,
      ),
    );
    subs.forEach((s, i) => geometry.addGroup(s.start, s.count, i));
    geometry.computeBoundingSphere();
    world.add(
      new THREE.Mesh(
        geometry,
        subs.map((s) => {
          if (!materials.has(s.material))
            throw Error(`Unbound map material ${s.material}`);
          return materials.get(s.material);
        }),
      ),
    );
    rendered++;
  }
  $("render-status").textContent =
    `${rendered} map meshes · ${textures.size} installed textures · WebGL`;
  $("asset-gaps").textContent =
    `${Object.keys(bindingData.unsupported).length} map materials (${omitted} submeshes) explicitly omitted. Dynamic map visibility and material shaders remain unresolved.`;
  $("status").textContent =
    "Map ready. Decode a matching replay to enable playback.";
  $("load").disabled = false;
  $("file").disabled = false;
  overview();
}
function overheadPlate(width, height, offset) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d");
  if (!ctx) throw Error("Champion overhead canvas unavailable");
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      depthWrite: false,
      sizeAttenuation: false,
    }),
  );
  s.position.y = offset;
  s.renderOrder = 100;
  return { sprite: s, texture, context: ctx, key: null };
}
function championPlate() {
  return overheadPlate(256, 80, 270);
}
function updateUnitPlate(entry, state) {
  const drawing = unitPlateDrawing(state),
    plate = entry.plate,
    key = JSON.stringify([
      state.present,
      state.dead,
      state.currentHealth,
      state.maxHealth,
      state.team,
    ]);
  plate.sprite.visible = drawing.visible;
  if (key !== plate.key) {
    paintChampionPlate(plate.context, drawing);
    plate.texture.needsUpdate = true;
    plate.key = key;
  }
  const factor =
    (2 * Math.tan((camera.fov * Math.PI) / 360)) /
    Math.max(1, renderer.domElement.clientHeight);
  plate.sprite.scale.set(
    ((drawing.width / 2) * factor) / Math.abs(entry.group.scale.x),
    ((drawing.height / 2) * factor) / Math.abs(entry.group.scale.y),
    1,
  );
}
function updateChampionPlate(entry, state) {
  const plate = entry.plate,
    key = JSON.stringify([
      state.dead,
      state.currentHealth,
      state.maxHealth,
      state.level,
      state.playerName,
      state.resourceValue,
      state.resourceMax,
    ]);
  plate.sprite.visible = !state.dead;
  if (key !== plate.key) {
    paintChampionPlate(
      plate.context,
      championPlateDrawing(
        state.playerName ?? "(name unavailable)",
        entry.hero.team,
        state,
        entry.resourcePresentation,
      ),
    );
    plate.texture.needsUpdate = true;
    plate.key = key;
  }
  const factor =
    (2 * Math.tan((camera.fov * Math.PI) / 360)) /
    Math.max(1, renderer.domElement.clientHeight);
  plate.sprite.scale.set(128 * factor, 40 * factor, 1);
}
function applySkinPresentation(model, asset) {
  const hidden = new Set(asset.hidden.map((x) => x.toLowerCase())),
    unsupported = new Set(
      Object.keys(asset.unsupportedMaterials).map((x) => x.toLowerCase()),
    );
  let unsupportedCount = 0;
  model.traverse((node) => {
    if (!node.isMesh) return;
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    // Preserve shader-mask attributes; glTF color multiplication is not the
    // game's character shader and blacks out some skins in this approximation.
    for (const material of mats) {
      material.vertexColors = false;
      material.needsUpdate = true;
    }
    if (
      mats.some(
        (m) =>
          hidden.has(m.name.toLowerCase()) ||
          unsupported.has(m.name.toLowerCase()),
      )
    ) {
      node.visible = false;
      if (mats.some((m) => unsupported.has(m.name.toLowerCase())))
        unsupportedCount++;
    }
  });
  return unsupportedCount;
}
async function loadAnimatedActor(asset, events) {
  const [modelBytes, graphBytes, catalogBytes] = await Promise.all([
    get(`${root}/${asset.model}`, true),
    get(`${root}/${asset.animationGraph}`, true),
    get(`${root}/${asset.animationCatalog}`, true),
  ]);
  const visibility = await submeshVisibility.bind(
      asset,
      modelBytes,
      graphBytes,
    ),
    gltf = await loader.parseAsync(modelBytes, `${root}/`);
  const binding = await animationPoses.bind(
      asset.animationGraph,
      graphBytes,
      catalogBytes,
    ),
    graphData = JSON.parse(new TextDecoder().decode(graphBytes)),
    catalog = binding.catalog;
  const group = new THREE.Group(),
    graph = createAnimationGraph(graphData, catalog, binding.clock),
    jointMap = new Map(),
    poseAssets = new Map();
  group.add(gltf.scene);
  gltf.scene.scale.setScalar(asset.scale);
  const unsupportedCount = applySkinPresentation(gltf.scene, asset);
  const submeshNodes = bindSubmeshVisibilityNodes(
    gltf.scene,
    visibility,
    asset.unsupportedMaterials,
  );
  for (const name of catalog.joints) {
    const sanitized = THREE.PropertyBinding.sanitizeNodeName(name),
      matches = [];
    gltf.scene.traverse((node) => {
      if (node.name === sanitized) matches.push(node);
    });
    if (matches.length !== 1)
      throw Error(`Unbound or ambiguous skeleton joint ${name}`);
    const node = matches[0];
    jointMap.set(name, {
      node,
      position: node.position.clone(),
      quaternion: node.quaternion.clone(),
      scale: node.scale.clone(),
    });
  }
  const atomicName = (name) => {
      const value = catalog.clips[name];
      if (!value) throw Error(`Missing preview asset ${name}`);
      return value.file;
    },
    previewFiles = {
      idle: atomicName(asset.previewClips.idle),
      run: atomicName(asset.previewClips.run),
    },
    files = new Set([
      ...Object.values(previewFiles),
      ...graph.dependencies("Death"),
      ...events.flatMap((e) => graph.dependencies(e.name)),
    ]),
    directory = binding.directory;
  await Promise.all(
    [...files].map(async (file) => {
      if (!/^clips\/\d+\.clip$/.test(file))
        throw Error("Invalid static clip package path");
      const bytes = await get(`${poseRoot}/${directory}/${file}`, true);
      if ((await sha256(bytes)) !== binding.expectedFileHash(file))
        throw Error("Atomic pose bytes differ from the prepared package");
      const pose = readAnimationAsset(bytes);
      for (const track of pose.tracks)
        if (
          catalog.joints[track.jointId] !== track.bone ||
          !jointMap.has(track.bone)
        )
          throw Error("Animation and skeleton joint mismatch");
      poseAssets.set(file, pose);
    }),
  );
  return {
    group,
    modelSha256: await sha256(modelBytes),
    graph,
    catalog,
    jointMap,
    poseAssets,
    previewFiles,
    previewNames: asset.previewClips,
    unsupportedCount,
    visibility,
    submeshNodes,
  };
}
async function loadWorldObjects(load) {
  const catalog = worldCatalog,
    bindings = bindLatestBuildings(report, manifest, catalog);
  for (const binding of bindings) {
    const gltf = await replayLoad.wait(
        load,
        loader.loadAsync(`${root}/${binding.asset.model}`),
      ),
      group = new THREE.Group();
    gltf.scene.scale.setScalar(binding.asset.scale);
    const unsupportedCount = applySkinPresentation(gltf.scene, binding.asset);
    group.add(gltf.scene);
    // BIN uses row-vector transforms with translation in row 4. The flat
    // storage is the equivalent column-vector matrix consumed by Three.js.
    group.matrix.fromArray(binding.object.transform.flat());
    group.matrix.decompose(group.position, group.quaternion, group.scale);
    world.add(group);
    const bounds = new THREE.Box3().setFromObject(group),
      point = bounds.getCenter(new THREE.Vector3());
    point.y = bounds.max.y + 40;
    const plate = overheadPlate(256, 28, 0);
    plate.sprite.position.copy(group.worldToLocal(point));
    group.add(plate.sprite);
    group.userData.replayEntityId = binding.event.entityId;
    buildings.push({ ...binding, group, plate, unsupportedCount });
  }
  const minionBindings = bindLatestMinions(report, manifest, catalog);
  minionCorpses = createLatestMinionCorpsePlayback(
    report,
    corpsePolicy,
    minionBindings,
  );
  for (const binding of minionBindings.minions) {
    const spellCatalog = await replayLoad.wait(
        load,
        get(`${root}/${binding.asset.spellCatalog}`),
      ),
      subject = {
        character: binding.asset.character,
        entityId: binding.event.entityId,
        characterRecords: [
          ...new Set(binding.unit.records.map((r) => r.characterRecord)),
        ],
      },
      combat = resolveCombatPresentation(subject, spellCatalog, report),
      events = [
        ...combat.actions,
        ...(animationTracks.get(binding.event.entityId) ?? []).map((event) => ({
          ...event,
          rate: event.scalar20,
          sourceKind: "animation-name",
        })),
      ].sort((a, b) => a.time - b.time || a.sequence - b.sequence),
      actor = await replayLoad.wait(
        load,
        loadAnimatedActor(binding.asset, events),
      );
    const entity = report.worldEntities.find(
      (e) => e.entityId === binding.event.entityId,
    );
    if (!entity || entity.entityClass !== "lane-minion")
      throw Error("Missing admitted minion state");
    const plate = overheadPlate(
      128,
      16,
      entity.healthBarHeight * binding.asset.scale,
    );
    actor.group.add(plate.sprite);
    actor.group.userData.replayEntityId = binding.event.entityId;
    world.add(actor.group);
    minions.push({
      ...binding,
      ...actor,
      plate,
      subject,
      combat,
      events,
      bindRootQuaternion: actor.group.quaternion.clone(),
    });
  }
  const attackJumps = minions
    .flatMap((entry) =>
      entry.events
        .filter(
          (event) =>
            event.sourceKind === "attack" &&
            entry.graph.evaluate(event.name, 0.1, { moving: false }).leaves
              .length,
        )
        .map((event) => ({ entry, event })),
    )
    .sort(
      (a, b) =>
        a.event.time - b.event.time || a.event.sequence - b.event.sequence,
    );
  $("minion-attack-jump").disabled = !attackJumps.length;
  $("minion-attack-jump").onclick = () => {
    if (replayLoad.loading) return;
    const jump = attackJumps[0];
    if (!jump) return;
    playing = false;
    $("play").textContent = "Play";
    time = jump.event.time + 0.15;
    renderTime();
    follow = jump.entry;
    const point = jump.entry.group.position;
    selectEntity(jump.entry.event.entityId);
    controls.target.set(point.x, point.y, -point.z);
    camera.position.copy(controls.target).add(new THREE.Vector3(0, 1500, 1100));
    controls.update();
    $("camera-status").textContent =
      "Following recorded minion attack · candidate animation timing";
  };
  $("minion-jump").disabled = minions.length === 0;
  $("minion-jump").onclick = () => {
    if (replayLoad.loading || !minions.length) return;
    const destinationTime = Math.min(
        report.endTime,
        minions[0].event.time + 16,
      ),
      point = sampleMinionPresentation(minions[0], destinationTime);
    playing = false;
    $("play").textContent = "Play";
    time = destinationTime;
    renderTime();
    follow = null;
    selectEntity(minions[0].event.entityId);
    controls.target.set(point.x, point.y, -point.z);
    camera.position.copy(controls.target).add(new THREE.Vector3(0, 1800, 1400));
    controls.update();
    $("camera-status").textContent =
      "Recorded minion wave · candidate barracks binding and locomotion";
  };
  $("world-jump").disabled = buildings.length === 0;
  $("world-jump").onclick = () => {
    if (replayLoad.loading) return;
    const entry =
      buildings.find((b) => /\/HA_Outer$/.test(b.object.characterRecord)) ??
      buildings[0];
    if (!entry) return;
    selectEntity(entry.event.entityId);
    follow = null;
    controls.target.set(
      entry.group.position.x,
      entry.group.position.y,
      -entry.group.position.z,
    );
    camera.position.copy(controls.target).add(new THREE.Vector3(0, 1600, 1200));
    controls.update();
    $("camera-status").textContent =
      `Recorded tower · ${entry.event.entityId.toString(16)} · skin ${entry.asset.skinId} · bind pose`;
  };
}
async function loadHeroes(load) {
  const requested = report.heroes.map((h) => {
    const key = `${h.champion.toLowerCase()}/${h.skinId}`,
      asset = manifest.champions[key];
    if (!asset) throw Error(`Skin package missing: ${key}`);
    return { hero: h, asset };
  });
  const roster = document.createDocumentFragment();
  for (const { hero, asset } of requested) {
    const spellCatalog = await replayLoad.wait(
      load,
      get(`${root}/${asset.spellCatalog}`),
    );
    const subject = {
        character: hero.champion,
        entityId: hero.entityId,
        characterRecords: asset.characterRecords,
      },
      combat = resolveCombatPresentation(subject, spellCatalog, report);
    const events = [
      ...(animationTracks.get(hero.entityId) ?? []).map((e) => ({
        ...e,
        rate: e.scalar20,
        sourceKind: "animation-name",
      })),
      ...combat.actions,
    ].sort((a, b) => a.time - b.time || a.sequence - b.sequence);
    const actor = await replayLoad.wait(load, loadAnimatedActor(asset, events));
    const plate = championPlate();
    actor.group.add(plate.sprite);
    actor.group.userData.replayEntityId = hero.entityId;
    const entry = {
      ...actor,
      hero,
      subject,
      asset,
      events,
      combat,
      spellCatalog,
      plate,
      resourcePresentation: primaryResourcePresentation(
        spellCatalog,
        asset.characterRecords,
        report.primaryResourceDefaults,
      ),
    };
    actorWorldPresentation.bindViewerPoseActor(hero.entityId, entry);
    world.add(actor.group);
    heroes.push(entry);
    const button = document.createElement("button");
    if (hero.team === 200) button.className = "red";
    const name = document.createElement("span"),
      skin = document.createElement("small");
    name.textContent = hero.champion;
    skin.textContent = `skin ${hero.skinId}`;
    button.append(name, skin);
    button.onclick = () => followHero(entry);
    roster.append(button);
  }
  $("roster").replaceChildren(roster);
}
function followHero(entry) {
  if (replayLoad.loading) return;
  directReplyLoop?.invalidate();
  cancelPreparedEffectPreview();
  effectLookahead?.invalidate();
  selectEntity(entry.hero.entityId);
  follow = entry;
  controls.target.set(
    entry.group.position.x,
    entry.group.position.y,
    -entry.group.position.z,
  );
  camera.position.copy(controls.target).add(new THREE.Vector3(0, 1800, 1400));
  controls.update();
  $("camera-status").textContent =
    `Following ${entry.hero.champion} · skin ${entry.hero.skinId}`;
}
function applyPose(
  entry,
  file,
  phase,
  weights = null,
  weight = 1,
  sourceFrame = null,
) {
  applyLatestViewerPoseLayer(
    entry,
    { file, phase, weights, weight, sourceFrame },
    { quaternionA, quaternionB, vectorA, vectorB },
  );
}
function resetPose(entry) {
  for (const joint of entry.jointMap.values()) {
    joint.node.position.copy(joint.position);
    joint.node.quaternion.copy(joint.quaternion);
    joint.node.scale.copy(joint.scale);
  }
}
function applyLoopingPosePreview(entry, kind, moving) {
  const name = entry.previewNames[kind],
    initial = entry.graph.evaluate(name, 0, { moving });
  if (initial.unresolved.length || !(initial.duration > 0))
    throw Error("Unprepared animation preview clock");
  // Existing idle/run preview convention; this does not recover the client's
  // graph transition or loop/reset controller.
  for (const layer of entry.graph.evaluate(name, time % initial.duration, {
    moving,
  }).leaves)
    applyPose(
      entry,
      layer.file,
      layer.phase,
      layer.weights,
      layer.weight,
      layer.sourceFrame,
    );
}
function applyDeathPreview(entry, life) {
  entry.submeshNodes.apply(entry.visibility.initialMask);
  const result = sampleLatestDeathPosePreview(entry.graph, life, time);
  if (!result) return false;
  // Pose preview convention: hold the final sample while the caller retains the
  // model. Minions have a separate native retention policy; champion cleanup,
  // corpse fading and death-variant selection remain unresolved.
  if (result.leaves.length !== 1)
    throw Error("Death visibility requires an admitted single atomic pose");
  for (const layer of result.leaves) {
    entry.submeshNodes.apply(
      entry.visibility.sample(layer.name, layer.eventFrame).mask,
    );
    applyPose(
      entry,
      layer.file,
      layer.phase,
      layer.weights,
      layer.weight,
      layer.sourceFrame,
    );
  }
  return true;
}
function recordedLayers(entry, moving) {
  const layers = new Map();
  for (const event of entry.events) {
    if (event.time > time) break;
    for (const leaf of entry.graph.evaluate(event.name, 0, { moving }).leaves)
      layers.set(leaf.track, event);
  }
  const active = [];
  for (const [track, event] of layers) {
    // Scalar 20 behaves like a rate, but its meaning is still a candidate.
    // A later event owns its track even after completion; old actions never resume.
    if (event.rate <= 0) continue;
    const result = entry.graph.evaluate(
      event.name,
      (time - event.time) * event.rate,
      { moving },
    );
    for (const leaf of result.leaves)
      if (leaf.track === track) active.push({ ...leaf, event });
  }
  return active.sort(
    (a, b) =>
      b.priority - a.priority ||
      a.event.time - b.event.time ||
      a.event.sequence - b.event.sequence,
  );
}
async function decode(buffer) {
  const load = replayLoad.begin();
  if (vfxRenderer === directEffectSession?.renderer) vfxRenderer = null;
  directReplyLoop?.close();
  directReplyLoop = null;
  directReplayClock = null;
  lastDrawStamp = null;
  knownCameraIntentKey = null;
  ownedFollowCameraUpdate.clear();
  directEffectSession?.close();
  directEffectSession = null;
  directEffectInputs = null;
  directEffectPending = null;
  cancelPreparedEffectPreview();
  effectLookahead?.invalidate();
  effectLookahead = null;
  presentedTime = 0;
  vfxRenderer?.dispose();
  vfxRenderer = null;
  effectPipeline = null;
  $("missile-jump").disabled = true;
  $("world-jump").disabled = true;
  $("death-jump").disabled = true;
  $("minion-jump").disabled = true;
  $("minion-attack-jump").disabled = true;
  $("action-jump").disabled = true;
  $("attack-jump").disabled = true;
  $("motion-jump").disabled = true;
  $("load").disabled = true;
  $("file").disabled = true;
  $("play").disabled = true;
  $("seek").disabled = true;
  $("error").textContent = "";
  playing = false;
  const geometries = new Set(),
    materials = new Set(),
    textures = new Set(),
    skeletons = new Set();
  for (const entry of [...heroes, ...buildings, ...minions]) {
    world.remove(entry.group);
    entry.group.traverse((node) => {
      if (node.geometry) geometries.add(node.geometry);
      if (node.skeleton) skeletons.add(node.skeleton);
      for (const material of node.material
        ? Array.isArray(node.material)
          ? node.material
          : [node.material]
        : []) {
        materials.add(material);
        for (const value of Object.values(material))
          if (value?.isTexture) textures.add(value);
      }
    });
  }
  for (const resource of [
    ...geometries,
    ...materials,
    ...textures,
    ...skeletons,
  ])
    resource.dispose();
  heroes.length = 0;
  for (const image of itemImages.values()) image.close();
  itemImages.clear();
  itemAssets = null;
  buildings.length = 0;
  minions.length = 0;
  report = null;
  replayState = null;
  minionCorpses = null;
  inspection = null;
  updateInspection();
  tracks = null;
  animationTracks = new Map();
  lifecycleTracks = new Map();
  actorWorldPresentation = null;
  follow = null;
  $("roster").replaceChildren();
  $("status").textContent = "Decoding the original ROFL in a browser worker…";
  worker?.terminate();
  const decodeWorker = new Worker("./structural-check-worker.mjs", {
    type: "module",
  });
  worker = decodeWorker;
  decodeWorker.onerror = (e) => {
    if (replayLoad.isCurrent(load) && worker === decodeWorker)
      fail(Error(e.message));
  };
  decodeWorker.onmessage = async ({ data }) => {
    if (!replayLoad.isCurrent(load) || worker !== decodeWorker) return;
    try {
      if (data.type === "error") throw Error(data.error);
      if (data.type !== "reconstruction") return;
      decodeWorker.terminate();
      worker = null;
      if (
        data.report.build !== manifest.build ||
        data.report.protocol !== manifest.protocol
      )
        throw Error("Replay and assets differ");
      // Publish only after discarding the previous replay's clock. World
      // sampling remains blocked until the complete resource load finishes.
      time = Math.min(45, data.report.endTime);
      presentedTime = time;
      previous = performance.now();
      report = data.report;
      const selectedMaterials =
        staticCatalog === null
          ? null
          : await replayLoad.wait(
              load,
              loadLatestSelectedMaterialRegistry({
                staticCatalog,
                load: async (path) =>
                  new Uint8Array(await get(`/assets/${path}`, true)),
              }),
            );
      const pipeline = await replayLoad.wait(
        load,
        createLatestEffectPipeline({
          report,
          effectsManifestBytes: effectManifestBytes,
          quadGpuBytes: selectedMaterials
            ? selectedMaterials.packageBytes("quad")
            : await get("/assets/latest-complete-quad-gpu/package.json", true),
          trailGpuBytes: selectedMaterials
            ? selectedMaterials.packageBytes("trail")
            : await get("/assets/latest-trail-particles/gpu.json", true),
          selectedMaterials,
        }),
      );
      effectPipeline = effectResolvers.bindTimeline(pipeline, report);
      const pipelineSummary = effectPipeline.summary;
      const contextSummary = summarizeEffectContextRequests(
        effectContexts.bindRequests(report),
      );
      $("effect-pipeline-evidence").textContent =
        `${pipelineSummary.creationRequests} creation requests and ${pipelineSummary.removalRequests} removal requests enter one ordered registry. All creation descriptors execute the original packet prefix in the decode worker.\n` +
        `${pipelineSummary.preparedResourceRequests} requests resolve prepared context resources (${pipelineSummary.uniqueEffects} effects); ${pipelineSummary.requestsWithGpuBindings} have at least one prepared GPU emitter and ${pipelineSummary.requestsWithAllGpuBindings} have bindings for every emitter. These are static preparation counts, not rendered spell coverage.\n` +
        `${contextSummary.preparedReferences}/${contextSummary.auxiliaryReferences} auxiliary references identify prepared character/skin contexts. The original auxiliary lookup order selects authored references for ${effectPipeline.resourceSummary.auxiliaryStages["matched-authored-reference"] ?? 0} requests (${effectPipeline.resourceSummary.selectedPreparedDefinitions} prepared definitions). These results stay attached to each request across seeking. Prior unit-context precedence, global lookup, live reference fixups and runtime creation remain unverified.\n` +
        `Factory finalization, parent activation, attachments, original clocks/seeds and removal/retirement remain unresolved. Creation/removal requests are retained across seeking; no request is counted as a successful native spawn or immediate deletion.\n\nResource gaps:\n` +
        Object.entries(pipelineSummary.resourceGaps)
          .map(([key, n]) => `${n} · ${key}`)
          .join("\n") +
        `\n\nShared dependencies:\n` +
        Object.entries(pipelineSummary.dependencyRequests)
          .map(([key, n]) => `${n} · ${key}`)
          .join("\n") +
        `\n\nEmitter feature gaps in bound requests:\n` +
        Object.entries(pipelineSummary.emitterGaps)
          .map(([key, n]) => `${n} · ${key}`)
          .join("\n");
      const ids = new Set(report.heroes.map((h) => h.entityId));
      animationTracks = indexMovement(report.animations);
      const movement = prepareLatestMovement(report, manifest.map);
      tracks = movement.tracks;
      const lifecycle = prepareLatestLifecycle(report);
      lifecycleTracks = lifecycle.tracks;
      viewerPoseAssets = await replayLoad.wait(
        load,
        loadLatestViewerPoseAssets({
          THREE,
          profile: viewerProfile,
          report,
          scene: manifest,
          staticCatalog,
          load: (path) =>
            get(`/assets/${path}`, true).then((bytes) => new Uint8Array(bytes)),
        }),
      );
      actorWorldPresentation = createLatestWorldPresentation({
        report,
        scene: manifest,
        terrain,
        viewerPoseAssets,
      });
      replayState = createLatestReplayState(report, {
        entities: report.worldEntities,
        updates: report.worldStateUpdates,
      });
      $("status").textContent =
        "Loading decoded champions and equipped skin candidates…";
      await replayLoad.wait(load, loadHeroes(load));
      await replayLoad.wait(load, loadInspectionItems(load));
      inspection = createLatestInspection(
        report,
        replayState,
        new Map(heroes.map((h) => [h.hero.entityId, h.resourcePresentation])),
        itemAssets,
      );
      $("status").textContent =
        "Binding decoded buildings to installed map objects…";
      await replayLoad.wait(load, loadWorldObjects(load));
      $("seek").max = String(report.endTime);
      $("seek").value = String(time);
      $("status").textContent = "Loading recorded combat presentation…";
      $("evidence").textContent =
        `${report.summary.movingHeroes}/10 heroes bound dynamically. ${report.summary.championStateUpdates} state updates cover HP, levels, primary resources and current gold. Player names use participant-slot metadata. Shields and exact HUD presentation remain unresolved. ${report.summary.heroMotionRecords} motion paths, ${report.summary.heroAnimationRecords} animation names, ${report.summary.attackRecords} total attack records and ${report.summary.heroCastRecords} hero casts. ${report.summary.missileRecords} missile replication candidates; an experimental particle subset is prepared separately. ${report.endTime}s decoded. ${Object.keys(report.unhandledOpcodes).length} gameplay opcodes unhandled. Full reference alignment not verified.`;
      const motionJump = report.movement.find(
        (record) => record.motion && ids.has(record.entityId),
      );
      $("motion-jump").disabled = !motionJump;
      $("motion-jump").onclick = () => {
        if (replayLoad.loading || !motionJump) return;
        const entry = heroes.find(
          (entry) => entry.hero.entityId === motionJump.entityId,
        );
        playing = false;
        $("play").textContent = "Play";
        time = motionJump.time + 0.8;
        renderTime();
        followHero(entry);
      };
      const unresolved = new Map();
      let renderedEvents = 0;
      const animatedActors = [...heroes, ...minions];
      for (const entry of animatedActors)
        for (const event of entry.events) {
          const result = entry.graph.evaluate(event.name, 0.01, {
            moving: false,
          });
          const reasons = result.unresolved.map((u) => u.reason);
          if (event.rate <= 0) reasons.push("Zero-rate semantics unresolved");
          if (reasons.length)
            for (const reason of reasons)
              unresolved.set(
                `${entry.subject.character} / ${event.name}: ${reason}`,
                (unresolved.get(
                  `${entry.subject.character} / ${event.name}: ${reason}`,
                ) ?? 0) + 1,
              );
          else if (result.leaves.length) renderedEvents++;
        }
      $("animation-gaps").textContent =
        `${renderedEvents}/${animatedActors.reduce((n, h) => n + h.events.length, 0)} hero/minion name/asset actions resolve to finite graph poses with a positive candidate rate.\n` +
        [...unresolved]
          .map(([reason, count]) => `${count}× ${reason}`)
          .join("\n");
      $("combat-gaps").textContent = heroes
        .flatMap((h) =>
          h.combat.gaps.map((g) => `${h.hero.champion}: ${g.reason}`),
        )
        .concat(
          minions.flatMap((entry) =>
            entry.combat.gaps.map(
              (g) => `${entry.asset.character}: ${g.reason}`,
            ),
          ),
        )
        .join("\n");
      $("world-evidence").textContent =
        `${report.summary.buildingIdentities} building identities, ${report.summary.laneMinionCreations} lane-minion spawns, ${report.summary.npcCreations} other NPC spawn records.\n` +
        `${buildings.length} towers bound by recorded map-name hashes to installed skins and transforms. Observed HP uses the native turret replication layout. Destruction, rubble, attacks and visibility unresolved.\n` +
        `${minions.length} minions use the candidate ascending map-key registry; every recorded tower must agree on its offset. Recorded attack slots bind only agreeing static spell/animation identities. Minion corpse retention uses the native lifetime getter/comparison with a replay-clock projection; attack timing, missile effects and corpse fading remain unresolved.\n` +
        `${report.worldStateUpdates.length} world HP updates drive minion/tower bars and restore on seeking. Minion team semantics are unresolved (neutral bar palette); geometry, placement and occlusion remain preview conventions.\n` +
        "NPC skin arguments are decoded; other NPC models/visibility/lifecycle are not rendered.\n\n" +
        report.worldEvents
          .filter((event) => event.kind === "building-identity-candidate")
          .map((event) => `${event.entityId.toString(16)} · ${event.name}`)
          .join("\n");
      $("lifecycle-evidence").textContent =
        `${report.summary.deaths} unit death records, ${report.summary.heroDeaths} hero deaths, ${report.summary.heroRespawns} hero respawns. ` +
        `${lifecycle.repeatedDeaths.length} repeated death notifications; ${lifecycle.unmatchedRespawns.length} respawns without a decoded death.\n` +
        "Death names/rates, event-boundary clock and final-pose holding are preview conventions. Native submesh events now control death mesh visibility. Minion lifetime retention uses native predicates with a projected replay clock; champion corpse cleanup, fading, particle events, zombie/forms and resurrection details remain unresolved.\n" +
        heroes
          .flatMap((entry) =>
            (lifecycleTracks.get(entry.hero.entityId) ?? [])
              .filter((interval) => interval.postDeathActions.length)
              .map(
                (interval) =>
                  `${entry.hero.champion}: ${interval.postDeathActions.length} post-death casts; corpse pose withheld until this state is understood.`,
              ),
          )
          .join("\n");
      const missileAnalysis = analyzeLatestMissiles(
        report,
        heroes.map((entry) => ({
          entityId: entry.hero.entityId,
          character: entry.hero.champion,
          catalog: entry.spellCatalog,
        })),
        missileMotionDefinition,
        {
          manifest,
          terrain,
          controllers: missileControllers,
          initialization: missileInitialization,
          frame: missileFrame,
          actors: missileActors,
        },
      );
      const effectBindings = bindLatestMissileEffects(report, effectManifest);
      const missilePlayback = buildLatestMissilePlayback(
        missileAnalysis,
        effectBindings,
        missileFrame,
        missileActors,
        report.endTime,
      );
      directEffectInputs = {
        world,
        report,
        scene: manifest,
        sceneManifestBytes,
        gpuRenderer: renderer,
        manifest: effectManifest,
        manifestBytes: effectManifestBytes,
        pipeline: effectPipeline,
        missilePlayback,
        viewerPoseAssets,
        staticCatalog,
      };
      $("status").textContent = "Loading shared effect resources…";
      const liveEffects = await replayLoad.wait(load, directEffects());
      const effectDiagnostics = await replayLoad.wait(
        load,
        liveEffects.inspect(),
      );
      vfxRenderer = liveEffects.renderer;
      vfxRenderer.enabled = $("particles").checked;
      const remainingParticleGaps = effectDiagnostics.definitions.flatMap(
        (definition) => [
          ...definition.blockers.map((reason) => `${definition.id}: ${reason}`),
          ...definition.unsupported.flatMap((component) =>
            component.reasons.map(
              (reason) => `${definition.id}:${component.index}: ${reason}`,
            ),
          ),
          ...definition.systemOmissions.map(
            (reason) => `${definition.id}: ${reason}`,
          ),
        ],
      );
      $("status").textContent =
        `Ready · ${heroes.length} champions · ${buildings.length} towers · ${minions.length} minions · experimental particles`;
      // Original emulated parent timelines remain CLI regression oracles.
      // Ordinary Play owns one retained shared runtime with no lookahead.
      const firstMissile = null;
      $("missile-jump").disabled = !firstMissile;
      $("smooth-effect").disabled = !firstMissile;
      $("smooth-effect").onclick = () =>
        prepareSmoothEffectPreview(firstMissile).catch(fail);
      $("missile-jump").onclick = () => {
        if (!firstMissile) return;
        playing = false;
        $("play").textContent = "Play";
        time = firstMissile.startTime + 0.08;
        $("particles").checked = true;
        vfxRenderer.enabled = true;
        renderTime();
        const owner = heroes.find(
          (entry) => entry.hero.entityId === firstMissile.ownerId,
        );
        if (!owner) throw Error("Missile camera owner missing");
        followHero(owner);
      };
      $("missile-evidence").textContent =
        `${report.summary.missileRecords} opcode-28 records; ${report.summary.heroOwnedMissileRecords} bound to decoded hero owners.\n` +
        `${missileAnalysis.summary.identities} native network identities; ${missileAnalysis.summary.repeatedIdentityRecords} repeated replication records retained. ${missileAnalysis.summary.contextDisagreements} disagreements with transport context IDs.\n` +
        `${missileAnalysis.summary.boundEventRecords}/${missileAnalysis.summary.eventRecords} missile-family notifications join those identities: ${missileAnalysis.summary.boundPhaseRecords} phase targets, ${missileAnalysis.summary.boundPresentationRecords} presentation bytes and ${missileAnalysis.summary.boundStopRecords} stops. ${missileAnalysis.summary.unboundEventRecords} notifications across ${missileAnalysis.summary.unboundEventIdentities} other identities remain unbound. Phase targets invoke components; stops zero velocity and notify presentation. Particle disappearance and presentation-byte meanings remain unresolved.\n` +
        `${missileAnalysis.summary.sameTimeEventsBeforeFirstReplication} notifications precede the first replication in the same timestamp. Recorded order is retained; initialization/dispatch ordering is not inferred from the identity join.\n` +
        `Creation/replication XYZ, cast endpoint, current movement speed and elapsed time decode through native getter tables. ${report.missiles.filter((event) => event.elapsedSeconds > 0).length} records in this window have positive elapsed time; the native controller applies replication XYZ only in that case.\n` +
        `${missileAnalysis.summary.forcedRecordedSourceRecords} records force the recorded cast source XYZ; ${missileAnalysis.summary.casterAttachmentSourceRecords} may use a caster/terrain/bone attachment. That native choice is decoded; the attachment and subsequent initialization are still unimplemented.\n` +
        `${missileAnalysis.summary.initializedFixedSpeedTargets} fixed-speed initial targets now use the translated native ground-height and target-height-offset rules. Cast-range projection and facing-derived endpoints remain unresolved. Initial targets do not establish full trajectories.\n` +
        `${missileAnalysis.summary.initializedRecordedStarts} recorded-source start descriptors and ${missileAnalysis.summary.initializedFixedSpeedPacketPositions} fixed-speed position/height snapshots initialize from decoded fields and native defaults. Caster/bone seeds, nonzero local offsets and complete controller state remain unprepared.\n` +
        `${missileAnalysis.summary.translatedTerrainHeightRecords} records bind translated terrain-following height settings; ${missileAnalysis.summary.blendedHeightExternalMathRecords} bind a blended-height component whose external powf equivalence remains unverified.\n` +
        `${missileAnalysis.summary.ownedFrameInputRecords} records have admitted inputs for the complete no-target controller frame: movement, arrival/snap, height, vertical facing and 60-position history. The clock is supplied explicitly. Actor collision, phase/stop handling and VFX lifetime are still separate; these are not complete rendered trajectories.\n` +
        `${missileAnalysis.summary.translatedPhaseCallbackRecords} records bind translated phase/frame callbacks (DestroyOnMovementComplete and CastOnHit's no-op phase/frame callbacks); ${missileAnalysis.summary.ownedMovementAndPhaseRecords} also have admitted controller-frame inputs. Initial phase, pending-child gate and initial presentation byte are decoded. Child registration, collision/hit/cast dispatch, actual phase timing and particle removal are not inferred.\n` +
        `${missileAnalysis.summary.boundSpellRecords} records bind to ${missileAnalysis.summary.uniqueBoundSpells} distinct owner/spell identities; motion components: ${Object.entries(
          missileAnalysis.summary.movementTypes,
        )
          .map(([name, count]) => `${name} ${count}`)
          .join(", ")}.\n` +
        `${missileAnalysis.summary.fixedSpeedComponents} fixed-speed definitions: ${missileAnalysis.summary.fixedSpeedTrackingTargets} target-tracking, ${missileAnalysis.summary.fixedSpeedNonTracking} non-tracking. Omitted tracking defaults to true in the original constructor. Remaining initialization, target updates, collision and complete lifetime remain unresolved.\n` +
        `${effectBindings.summary.statuses["prepared-definition"] ?? 0} records bind to ${effectBindings.summary.uniquePreparedEffects} equipped-skin VFX definitions. The static package retains ${effectManifest.summary.effects} definitions, ${effectManifest.summary.textureFiles} texture files and ${effectManifest.summary.staticMeshes} static meshes. ${effectManifest.summary.unpreparedAssets} animated-mesh dependencies remain untranslated.\n` +
        `Shared retained runtime: ${liveEffects.summary.events} ordered presentation events and ${liveEffects.summary.definitions} compiled definitions. Unsupported components and unresolved world inputs remain identifiable; prepared definitions do not count as rendered effects.\n` +
        `Simulation runs in the browser worker using typed arrays. Camera draws retain simulation state; seeking restores simulation checkpoints. Resource/placement policies, clocks and seeds remain partial presentation inputs. Browser performance, five-champion/twenty-definition coverage and League image parity remain unverified.\n` +
        `${missilePlayback.summary.clockPolicy}. Visibility is an omniscient preview; actual frame scheduling, impact positions, complete particles/shaders, fog and audio remain unresolved.\n\n` +
        missileAnalysis.records
          .slice(0, 12)
          .map(
            (event) =>
              `${event.time.toFixed(3)}s · ${event.definitionName ?? `unbound spell ${event.cast.spellHash.toString(16)}`} · ${event.movementType ?? event.bindingStatus} · speed ${event.movementSpeed.toFixed(1)} · elapsed ${event.elapsedSeconds.toFixed(3)}s · creation XYZ ${event.creationPosition.map((value) => value.toFixed(1)).join(", ")}`,
          )
          .join("\n");
      $("particle-gaps").textContent = remainingParticleGaps.join("\n");
      const firstDeath = report.lifecycle.find(
        (event) => event.kind === "death-candidate" && ids.has(event.entityId),
      );
      $("death-jump").disabled = !firstDeath;
      $("death-jump").onclick = () => {
        if (!firstDeath) return;
        playing = false;
        $("play").textContent = "Play";
        time = firstDeath.time + 0.7;
        renderTime();
        followHero(
          heroes.find((entry) => entry.hero.entityId === firstDeath.entityId),
        );
      };
      const jumps = heroes
        .flatMap((entry) =>
          entry.events
            .filter(
              (event) =>
                event.rate > 0 &&
                event.sourceKind === "animation-name" &&
                /spell|attack/i.test(event.name) &&
                entry.graph.evaluate(event.name, 0.1, { moving: false }).leaves
                  .length,
            )
            .map((event) => ({ entry, event })),
        )
        .sort(
          (a, b) =>
            a.event.time - b.event.time || a.event.sequence - b.event.sequence,
        );
      $("action-jump").disabled = !jumps.length;
      $("action-jump").onclick = () => {
        const jump = jumps[0];
        if (!jump) return;
        playing = false;
        $("play").textContent = "Play";
        time = jump.event.time + 0.15;
        renderTime();
        followHero(jump.entry);
      };
      const attackJumps = heroes
        .flatMap((entry) =>
          entry.events
            .filter(
              (event) =>
                event.sourceKind === "attack" &&
                entry.graph.evaluate(event.name, 0.1, { moving: false }).leaves
                  .length,
            )
            .map((event) => ({ entry, event })),
        )
        .sort(
          (a, b) =>
            a.event.time - b.event.time || a.event.sequence - b.event.sequence,
        );
      $("attack-jump").disabled = !attackJumps.length;
      $("attack-jump").onclick = () => {
        const jump = attackJumps[0];
        if (!jump) return;
        playing = false;
        $("play").textContent = "Play";
        time = jump.event.time + 0.15;
        renderTime();
        followHero(jump.entry);
      };
      replayLoad.complete(load);
      $("play").textContent = "Play";
      $("play").disabled = false;
      $("seek").disabled = false;
      $("load").disabled = false;
      $("file").disabled = false;
      renderTime();
    } catch (error) {
      if (replayLoad.isCurrent(load)) fail(error);
    }
  };
  const selectionInput =
    staticCatalog === null
      ? {}
      : { staticCatalogInitialization: staticCatalog.serializeForWorker() };
  if (buffer)
    worker.postMessage({ type: "reconstruct", buffer, ...selectionInput }, [
      buffer,
    ]);
  else worker.postMessage({ type: "reconstruct", ...selectionInput });
}
$("load").onclick = () => decode().catch(fail);
$("file").onchange = async () => {
  try {
    const f = $("file").files[0];
    if (f) await decode(await f.arrayBuffer());
  } catch (e) {
    fail(e);
  }
};
$("play").onclick = () => {
  if (directReplayClock) time = directReplayClock.read(performance.now());
  playing = !playing;
  directCaptureOwnership.blocksOrdinary(playing);
  if (preparedEffects.frames.length) {
    if (playing && time >= preparedEffects.frames.at(-1).time)
      time = preparedEffects.frames[0].time;
    preparedPlaybackClock = time;
    $("play").textContent = playing ? "Pause" : "Play";
    previous = performance.now();
    return;
  }
  if (playing && time >= report.endTime) time = 0;
  $("play").textContent = playing ? "Pause" : "Play";
  renderTime();
};
$("seek").oninput = () => {
  time = Number($("seek").value);
  if (
    preparedEffects.frames.length &&
    time >= preparedEffects.frames[0].time &&
    time <= preparedEffects.frames.at(-1).time
  ) {
    preparedPlaybackClock = time;
    previous = performance.now();
    return;
  }
  renderTime();
};
$("speed").onchange = () => {
  if (directReplayClock) time = directReplayClock.read(performance.now());
  speed = Number($("speed").value);
  resetDirectClock();
  previous = performance.now();
};
$("particles").onchange = () => {
  if (directReplayClock) time = directReplayClock.read(performance.now());
  if (vfxRenderer) vfxRenderer.enabled = $("particles").checked;
  effectLookahead?.invalidate();
  renderTime();
};
function renderTime() {
  cancelPreparedEffectPreview();
  resetDirectClock();
  previous = performance.now();
  if (report)
    $("particle-status").textContent = `Partial effects · ${fmt(time)}`;
}
function cancelPreparedEffectPreview(
  message = "Prepare a short effect sequence for smooth playback.",
) {
  if (!preparingEffectPreview && !preparedEffects.frames.length) return;
  effectPreviewJob++;
  preparingEffectPreview = false;
  preparedEffects.clear();
  preparedPlaybackClock = null;
  playing = false;
  $("play").textContent = "Play";
  if (vfxRenderer?.ready) vfxRenderer.group.visible = true;
  $("smooth-effect").disabled = !vfxRenderer?.ready;
  $("smooth-effect-status").textContent = message;
  previous = performance.now();
}
controls.addEventListener("start", () => {
  cameraIntentVersion++;
  directReplyLoop?.invalidate();
  cameraInteracting = true;
  effectLookahead?.invalidate();
  cancelPreparedEffectPreview(
    "Camera moved · live inspection. Prepare again for smooth effect playback.",
  );
});
controls.addEventListener("end", () => {
  cameraIntentVersion++;
  directReplyLoop?.invalidate();
  cameraInteracting = false;
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = damping;
});
async function prepareSmoothEffectPreview(trace) {
  if (!trace || !report || !vfxRenderer?.ready) return;
  cancelPreparedEffectPreview();
  effectLookahead?.invalidate();
  const dataset = report,
    effects = vfxRenderer;
  playing = false;
  $("play").textContent = "Play";
  $("particles").checked = true;
  effects.enabled = true;
  time = Math.fround(trace.startTime - 15 / 60);
  presentedTime = time;
  applyWorldTime();
  const owner = heroes.find((entry) => entry.hero.entityId === trace.ownerId);
  if (!owner) throw Error("Prepared effect camera owner missing");
  followHero(owner);
  follow = null;
  // Flush remaining orbit damping before capturing the fixed preview camera.
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = damping;
  const fixedCamera = camera.clone(),
    job = ++effectPreviewJob;
  const times = Array.from({ length: 121 }, (_, i) =>
    Math.fround(trace.startTime + (i - 15) / 60),
  );
  preparingEffectPreview = true;
  $("smooth-effect").disabled = true;
  $("smooth-effect-status").textContent =
    "Preparing smooth playback · 0 / 121 frames";
  try {
    await effectLookahead?.pending;
    if (
      job !== effectPreviewJob ||
      report !== dataset ||
      vfxRenderer !== effects
    )
      return;
    effects.group.visible = false;
    const completed = await preparedEffects.prepare({
      effects,
      camera: fixedCamera,
      times,
      onProgress: ({ completed, total }) => {
        $("smooth-effect-status").textContent =
          `Preparing smooth playback · ${completed} / ${total} frames`;
      },
    });
    if (
      !completed ||
      job !== effectPreviewJob ||
      report !== dataset ||
      vfxRenderer !== effects
    )
      return;
    effects.group.visible = true;
    time = times[0];
    preparedPlaybackClock = time;
    playing = true;
    $("play").textContent = "Pause";
    previous = performance.now();
    $("smooth-effect-status").textContent =
      "Prepared · 2-second sequence. Play replays it; orbit returns to live inspection.";
    $("camera-status").textContent =
      "Prepared effect view · drag to return to live inspection";
  } finally {
    if (job === effectPreviewJob) {
      preparingEffectPreview = false;
      $("smooth-effect").disabled = false;
    }
  }
}
function sampleHeroPresentation(entry, at) {
  const life = sampleLatestLifecycle(
      lifecycleTracks.get(entry.hero.entityId),
      at,
    ),
    state = sampleMovement(
      tracks.get(entry.hero.entityId),
      life.dead ? life.interval.death.time : at,
    );
  let x,
    z,
    y,
    moving = false,
    direction = [0, 1];
  if (state) {
    [x, z] = state.point;
    y = height(x, z);
    moving = !life.dead && state.moving;
    direction = state.direction;
  } else [x, y, z] = entry.hero.creationPosition;
  if (!life.dead && !movementFollowsRespawn(state, life.respawn)) {
    [x, z] = life.respawn.point;
    y = height(x, z);
    moving = false;
  }
  const rootPoint = actorWorldPresentation.viewerRoot(entry.hero.entityId, at);
  if (!rootPoint.resolved)
    throw Error(
      `Visible actor root unresolved: ${rootPoint.reasons.join(",")}`,
    );
  [x, y, z] = rootPoint.position;
  return { life, state, x, y, z, moving, direction };
}
function sampleMinionPresentation(entry, at) {
  const life = sampleLatestLifecycle(
      lifecycleTracks.get(entry.event.entityId),
      at,
    ),
    state = sampleMovement(
      tracks.get(entry.event.entityId),
      life.dead ? life.interval.death.time : at,
    );
  const [x, z] = state?.point ?? [
    entry.creationPosition[0],
    entry.creationPosition[2],
  ];
  return { life, state, x, y: height(x, z), z };
}
function applyFollowAt(at) {
  if (replayLoad.loading || !follow) return;
  const position = sampleViewerFollowPosition(follow, at, {
    sampleHero(entry, time) {
      const { x, y, z } = sampleHeroPresentation(entry, time);
      return [x, y, z];
    },
    sampleMinion(entry, time) {
      if (!minionCorpses.sample(entry.event.entityId, time).visible)
        return { visible: false };
      const { x, y, z } = sampleMinionPresentation(entry, time);
      return { visible: true, position: [x, y, z] };
    },
  });
  if (!position) {
    follow = null;
    $("camera-status").textContent =
      "Follow target is not present at this time.";
    return;
  }
  applyViewerFollowTranslation(camera, controls, position);
}
function applyWorldTime({ updateFollow = true } = {}) {
  if (replayLoad.loading || !report) return;
  const startedAt = performance.now();
  if (effectPipeline) {
    const state = effectPipeline.seek(time);
    $("effect-pipeline-status").textContent =
      `Effect requests: ${state.creationRequested} awaiting runtime · ${state.removalRequested} removal requested · ${state.removalWithoutObservedCreation} without observed creation`;
  }
  updateInspection();
  for (const entry of buildings) {
    entry.group.visible = time >= entry.event.time;
    updateUnitPlate(
      entry,
      replayState.sampleEntity(entry.event.entityId, time),
    );
  }
  const active = [];
  for (const entry of heroes) {
    updateChampionPlate(
      entry,
      replayState.sampleEntity(entry.hero.entityId, time),
    );
    const pose = actorWorldPresentation.presentViewerPose(
      entry.hero.entityId,
      time,
    );
    if (!pose.resolved)
      throw Error(
        `Visible actor local pose unresolved: ${pose.reasons.join(",")}`,
      );
    entry.submeshNodes.apply(entry.visibility.initialMask);
    if (pose.deathPreview) {
      if (pose.layers.length !== 1)
        throw Error("Death visibility requires one shared atomic pose");
      const layer = pose.layers[0];
      entry.submeshNodes.apply(
        entry.visibility.sample(layer.name, layer.eventFrame).mask,
      );
      active.push(
        `${entry.hero.champion} · recorded death / corpse pose preview`,
      );
      continue;
    }
    if (pose.lifecycle === "dead")
      active.push(`${entry.hero.champion} · post-death behavior unresolved`);
    for (const layer of pose.layers.filter((layer) => layer.event)) {
      active.push(
        `${entry.hero.champion} · ${layer.event.sourceKind} · ${layer.event.name}`,
      );
    }
  }
  let liveMinions = 0,
    corpseMinions = 0,
    retiredMinions = 0,
    attackingMinions = 0;
  for (const entry of minions) {
    const corpseState = minionCorpses.sample(entry.event.entityId, time);
    entry.group.visible = corpseState.visible;
    if (corpseState.status === "Retired corpse") retiredMinions++;
    updateUnitPlate(
      entry,
      replayState.sampleEntity(entry.event.entityId, time),
    );
    restoreViewerMinionBindPreview(entry);
    if (!entry.group.visible) continue;
    const { life, state, x, y, z } = sampleMinionPresentation(entry, time);
    entry.group.position.set(x, y, z);
    if (state)
      entry.group.rotation.y = Math.atan2(
        state.direction[0],
        state.direction[1],
      );
    resetPose(entry);
    if (applyDeathPreview(entry, life)) corpseMinions++;
    else {
      applyLoopingPosePreview(
        entry,
        state?.moving ? "run" : "idle",
        state?.moving ?? false,
      );
      let attacking = false;
      for (const layer of recordedLayers(entry, state?.moving ?? false)) {
        applyPose(
          entry,
          layer.file,
          layer.phase,
          layer.weights,
          layer.weight,
          layer.sourceFrame,
        );
        if (layer.event.sourceKind === "attack") {
          attacking = true;
          const target = layer.event.sourceEvent.targetPosition,
            dx = target[0] - x,
            dz = target[2] - z;
          if (
            (target[0] !== 0 || target[2] !== 0) &&
            Math.hypot(dx, dz) > 0.001
          )
            entry.group.rotation.y = Math.atan2(dx, dz);
        }
      }
      if (attacking) attackingMinions++;
      liveMinions++;
    }
  }
  $("world-status").textContent =
    `${buildings.filter((e) => e.group.visible).length} towers · ${liveMinions} living minion candidates · ${attackingMinions} attack previews · ${corpseMinions} corpse previews · ${retiredMinions} retired corpses`;
  if (attackingMinions)
    active.push(`${attackingMinions} minion attack previews`);
  if (updateFollow) applyFollowAt(time);
  $("clock").textContent = `${fmt(time)} / ${fmt(report.endTime)}`;
  $("seek").value = String(time);
  $("particle-status").textContent = particleStatus();
  $("action-status").textContent = active.length
    ? active.join(" · ")
    : "No finite recorded animation active at this time.";
  worldUpdateAndHudMs += performance.now() - startedAt;
}
let previous = performance.now();
let performanceWindow = previous,
  displayFrames = 0;
function drawScene(
  view,
  mode,
  {
    record = true,
    directEffectFrame = null,
    directEffectRenderer = vfxRenderer,
    followEntityId = follow?.hero?.entityId ?? null,
    presentation = null,
  } = {},
) {
  const gpuTimings =
    record &&
    spectatorRecording &&
    !spectatorRecording.closed &&
    diagnosticFrame &&
    report
      ? spectatorGpuTimings
      : null;
  gpuTimings?.begin({
    wallTime: diagnosticFrame.wallTime,
    replayTime: time,
    replayHash: report.replaySha256,
    mode,
  });
  const startedAt = performance.now();
  let renderSubmissionMs;
  try {
    directEffectRenderer?.submitStagedDirect?.();
    renderer.render(scene, view);
  } finally {
    renderSubmissionMs = performance.now() - startedAt;
    gpuTimings?.end();
  }
  presentedCamera.copy(view);
  const drawCompletedAt = performance.now();
  if (record && report)
    lastDrawStamp = {
      drawId: ++drawSerial,
      drawWallTime: drawCompletedAt,
      presentedTime: time,
      stateKey: String(time),
      worldStateKey: String(time),
      particleStateKey: directEffectFrame
        ? String(directEffectFrame.metrics.simulationSteps)
        : null,
      cameraKey: JSON.stringify([
        view.matrixWorld.elements,
        view.projectionMatrix.elements,
      ]),
      epoch: directReplyLoop?.epoch ?? 0,
      playing,
      speed,
      mode,
      effectsEnabled: !!vfxRenderer?.enabled,
      effectsVisible: !!vfxRenderer?.group.visible,
      replayHash: report.replaySha256,
      width: renderer.domElement.width,
      height: renderer.domElement.height,
      pixelRatio: renderer.getPixelRatio(),
      simulationStepsAdvanced:
        directEffectFrame?.metrics.simulationStepsAdvanced ?? 0,
      requestToPresentMs: presentation
        ? drawCompletedAt - presentation.requestedAt
        : null,
      effectPreparationActive:
        !!effectLookahead?.active ||
        preparingEffectPreview ||
        !!directEffectPending,
    };
  if (record && spectatorRecording && diagnosticFrame && report) {
    const effectWorkerRequests =
      (vfxRenderer?.playback?.contexts ?? []).reduce(
        (total, context) => total + context.client.pending.size,
        0,
      ) + (directEffectSession?.client.pending.size ?? 0);
    spectatorRecording.frame({
      wallTime: diagnosticFrame.wallTime,
      drawId: lastDrawStamp.drawId,
      drawWallTime: lastDrawStamp.drawWallTime,
      epoch: lastDrawStamp.epoch,
      stateKey: lastDrawStamp.stateKey,
      worldStateKey: lastDrawStamp.worldStateKey,
      particleStateKey: lastDrawStamp.particleStateKey,
      cameraKey: lastDrawStamp.cameraKey,
      simulationStepsAdvanced: lastDrawStamp.simulationStepsAdvanced,
      requestToPresentMs: lastDrawStamp.requestToPresentMs,
      desiredTime: directReplayClock?.read(diagnosticFrame.wallTime) ?? time,
      presentation,
      replayHash: report.replaySha256,
      replayTime: time,
      presentedTime,
      speed,
      playing,
      mode,
      effectsEnabled: !!vfxRenderer?.enabled,
      effectsVisible: !!vfxRenderer?.group.visible,
      effectPreparationActive:
        !!effectLookahead?.active ||
        preparingEffectPreview ||
        !!directEffectPending,
      effectWorkerRequests,
      worldUpdateAndHudMs,
      effectCommitMs,
      renderSubmissionMs,
      directEffectFrame,
      width: renderer.domElement.width,
      height: renderer.domElement.height,
      pixelRatio: renderer.getPixelRatio(),
      cameraPosition: view.position.toArray(),
      cameraQuaternion: view.quaternion.toArray(),
      followEntityId,
      renderCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    });
  }
  displayFrames++;
  const now = performance.now();
  if (now - performanceWindow >= 500) {
    $("performance-status").textContent =
      `${Math.round((displayFrames * 1000) / (now - performanceWindow))} draw fps · ${mode}`;
    displayFrames = 0;
    performanceWindow = now;
  }
}
function particleStatus() {
  return vfxRenderer
    ? `${vfxRenderer.stats.visibleEffectInstances ?? 0} effect instances · ${vfxRenderer.stats.visibleQuads ?? 0} quad particles · ${vfxRenderer.stats.visibleTrailPoints ?? 0} trail points · partial effects`
    : "Particle preview not prepared";
}
function captureEffectCameraPath() {
  const base = camera.clone(),
    owner = follow,
    offset = camera.position.clone().sub(controls.target);
  return (at) => {
    const view = base.clone();
    if (owner) {
      const { x, y, z } = sampleHeroPresentation(owner, at);
      view.position.set(x, y, -z).add(offset);
    }
    view.updateWorldMatrix(true, false);
    return view;
  };
}
function cameraIntentKey() {
  camera.updateWorldMatrix(true, false);
  return JSON.stringify([
    camera.matrixWorld.elements,
    camera.projectionMatrix.elements,
  ]);
}
function updateViewerControls() {
  const owned = ownedFollowCameraUpdate.consume(
    cameraIntentKey(),
    cameraInteracting,
  );
  controls.update();
  if (owned) knownCameraIntentKey = cameraIntentKey();
}
function observeDirectCameraIntent() {
  const key = cameraIntentKey();
  if (knownCameraIntentKey !== null && key !== knownCameraIntentKey) {
    cameraIntentVersion++;
    directReplyLoop?.invalidate();
  }
  knownCameraIntentKey = key;
}
function resetDirectClock() {
  if (!report) return;
  directReplayClock = new LatestDesiredReplayClock(
    { time, playing, speed, endTime: report.endTime },
    performance.now(),
  );
  directReplyLoop?.invalidate();
}
function ensureDirectReplyLoop() {
  if (
    directReplyLoop &&
    replySession === directEffectSession &&
    replyReport === report
  )
    return;
  directReplyLoop?.close();
  const session = directEffectSession,
    dataset = report;
  replySession = session;
  replyReport = dataset;
  resetDirectClock();
  directReplyLoop = new LatestDirectReplyLoop({
    now: () => performance.now(),
    nextIntent(now) {
      if (
        replayLoad.loading ||
        report !== dataset ||
        directEffectSession !== session ||
        !session.renderer.enabled ||
        directCaptureOwnership.blocksOrdinary(playing) ||
        preparedEffects.frames.length ||
        preparingEffectPreview
      )
        return null;
      observeDirectCameraIntent();
      time = directReplayClock.read(now);
      const startedAt = performance.now();
      applyFollowAt(time);
      camera.updateWorldMatrix(true, false);
      knownCameraIntentKey = cameraIntentKey();
      if (follow) ownedFollowCameraUpdate.mark(knownCameraIntentKey);
      const view = camera.clone();
      return {
        time,
        view,
        cameraIntentVersion,
        capturedFollow: follow,
        key: JSON.stringify([
          time,
          view.aspect,
          view.matrixWorld.elements,
          view.projectionMatrix.elements,
        ]),
        followEntityId: follow?.hero?.entityId ?? null,
        followCpuMs: performance.now() - startedAt,
      };
    },
    request: (intent) => session.requestPresentation(intent.time, intent.view),
    accept: (result, intent) => {
      observeDirectCameraIntent();
      return (
        !replayLoad.loading &&
        report === dataset &&
        directEffectSession === session &&
        session.renderer.enabled &&
        !directCaptureOwnership.blocksOrdinary(playing) &&
        intent.cameraIntentVersion === cameraIntentVersion &&
        intent.capturedFollow === follow &&
        intent.view.aspect === camera.aspect &&
        result.time === intent.time &&
        session.isPresentationCurrent(result)
      );
    },
    claim: (result, epoch) => session.claimPresentation(result, epoch),
    isClaimCurrent: (ticket, epoch) =>
      session.isPresentationClaimCurrent(ticket, epoch),
    release: (ticket) => session.releasePresentationClaim(ticket),
    present(ready) {
      const { result, intent } = ready;
      diagnosticFrame = { wallTime: performance.now() };
      worldUpdateAndHudMs = intent.followCpuMs;
      effectCommitMs = 0;
      try {
        time = result.time;
        presentedTime = time;
        applyWorldTime({ updateFollow: false });
        const startedAt = performance.now();
        session.renderer.commitDirect(result.packet, intent.view);
        effectCommitMs = performance.now() - startedAt;
        session.renderer.group.visible = true;
        drawScene(intent.view, "shared effects", {
          followEntityId: intent.followEntityId,
          directEffectFrame: {
            requestId: result.requestId,
            time: result.packet.time,
            operation: result.operation,
            metrics: session.renderer.frameMetrics,
          },
          presentation: {
            epoch: ready.epoch,
            requestedAt: ready.requestedAt,
            operation: result.operation,
          },
        });
        if (playing && time === dataset.endTime) {
          playing = false;
          $("play").textContent = "Play";
          resetDirectClock();
        }
      } finally {
        time = directReplayClock.read(performance.now());
        diagnosticFrame = null;
      }
    },
    onError(error) {
      report = null;
      fail(error);
    },
  });
}
function recordDirectDisplayTick(rafTime) {
  const now = performance.now();
  if (!spectatorRecording || !lastDrawStamp || !report) return;
  spectatorRecording.displayTick({
    rafTime,
    ...lastDrawStamp,
    wallTime: now,
    desiredEpoch: directReplyLoop.epoch,
    desiredTime: directReplayClock.read(now),
    desiredPlaying: playing,
    desiredSpeed: speed,
  });
}
async function frame(now) {
  diagnosticFrame = { wallTime: performance.now() };
  worldUpdateAndHudMs = 0;
  effectCommitMs = 0;
  try {
    // Account for the entire interval, including rendering and worker waits.
    // Worker completion must never reset the match clock.
    const delta = Math.max((now - previous) / 1000, 0);
    previous = now;
    if (replayLoad.loading) {
      controls.update();
      drawScene(camera, "loading replay", {
        record: false,
        directEffectRenderer: null,
      });
      return;
    }
    // Capture owns automatic world and camera updates while paused, including
    // OrbitControls' follow/lookAt synchronization before a worker reply.
    if (directCaptureOwnership.blocksOrdinary(playing)) return;
    if (preparedEffects.frames.length && report && vfxRenderer?.ready) {
      const end = preparedEffects.frames.at(-1).time;
      if (playing)
        preparedPlaybackClock = Math.min(
          end,
          preparedPlaybackClock + delta * speed,
        );
      if (preparedPlaybackClock >= end) {
        playing = false;
        $("play").textContent = "Play";
      }
      try {
        const packet = preparedEffects.sample(preparedPlaybackClock);
        // World and effects use the same retained 60 Hz timestamp. The playback
        // clock remains continuous so slower displays do not accumulate lag.
        presentedTime = packet.time;
        time = packet.time;
        applyWorldTime();
        vfxRenderer.group.visible = true;
        const commitStartedAt = performance.now();
        vfxRenderer.commitFrame(packet);
        effectCommitMs += performance.now() - commitStartedAt;
        drawScene(preparedEffects.camera, "prepared effects");
      } catch (error) {
        fail(error);
      }
      return;
    }
    if (preparingEffectPreview) {
      controls.update();
      try {
        drawScene(camera, "preparing smooth playback");
      } catch (error) {
        fail(error);
      }
      return;
    }
    try {
      updateViewerControls();
      if (!report) {
        drawScene(camera, "scene");
        return;
      }
      if (vfxRenderer && !vfxRenderer.ready) {
        drawScene(camera, "loading effects");
        return;
      }
      const effects = vfxRenderer,
        desiredTime = playing
          ? Math.min(report.endTime, time + delta * speed)
          : time;
      observeDirectCameraIntent();
      if (directEffectSession && effects === directEffectSession.renderer) {
        ensureDirectReplyLoop();
        time = directReplayClock.read(performance.now());
        if (effects.enabled) directReplyLoop.tick();
        else {
          diagnosticFrame = { wallTime: performance.now() };
          time = directReplayClock.read(diagnosticFrame.wallTime);
          presentedTime = time;
          applyWorldTime();
          effects.group.visible = false;
          drawScene(camera, "shared effects");
          if (playing && time === report.endTime) {
            playing = false;
            $("play").textContent = "Play";
            resetDirectClock();
          }
        }
        recordDirectDisplayTick(now);
        return;
      }
      if (effects?.enabled && effectLookahead) {
        if (!cameraInteracting)
          effectLookahead.prefetch({
            time: desiredTime,
            speed,
            playing,
            cameraAt: captureEffectCameraPath(),
          });
        if (effectLookahead.required(desiredTime)) {
          // A real buffer miss is visible and holds the playhead. The requested
          // speed resumes after preparation; required effects cannot disappear.
          presentedTime = time;
          applyWorldTime();
          effects.group.visible = false;
          const job = effectLookahead.active;
          $("particle-status").textContent = cameraInteracting
            ? "Move camera · effects rebuffer when you release"
            : `Buffering effects · ${job?.completed ?? 0} / ${job?.total ?? 121} frames`;
          drawScene(camera, "buffering effects");
          return;
        }
      }
      time = desiredTime;
      if (playing && time === report.endTime) {
        playing = false;
        $("play").textContent = "Play";
      }
      const presentation = effects?.enabled
        ? effectLookahead?.presentation(time)
        : null;
      if (presentation) {
        const playhead = time;
        // Quantize world state and effects together while keeping the playback
        // clock continuous. 4x may skip displays, never the native simulation ticks.
        time = presentation.frame.time;
        presentedTime = time;
        applyWorldTime();
        time = playhead;
        const commitStartedAt = performance.now();
        effects.commitFrame(presentation.frame);
        effectCommitMs += performance.now() - commitStartedAt;
        effects.group.visible = true;
        camera.copy(presentation.camera);
        drawScene(camera, "buffered effects");
        $("particle-status").textContent = particleStatus();
      } else {
        presentedTime = time;
        applyWorldTime();
        if (effects) effects.group.visible = false;
        drawScene(camera, "playback");
        const job = effectLookahead?.active;
        $("particle-status").textContent = !effects?.enabled
          ? "Effects off"
          : job
            ? `Preparing upcoming effects · ${job.completed} / ${job.total} frames`
            : "No supported particle effect active at this time";
      }
    } catch (e) {
      report = null;
      fail(e);
    }
  } finally {
    diagnosticFrame = null;
    // The next interval includes simulation, transfers and drawing. Waiting
    // asynchronously creates no main-thread stall and never slows the clock.
    requestAnimationFrame(frame);
  }
}
requestAnimationFrame(frame);
selectedStaticRoot().then(loadMap).catch(fail);

// User-exportable diagnostics keep native/offscreen evidence separate from
// ordinary browser acceptance. Routing Play through the shared partial runtime
// does not establish the coverage/performance gates or League image parity.
async function directEffects() {
  if (!directEffectInputs)
    throw Error("Decode a replay before inspecting direct effects");
  if (directEffectSession) return directEffectSession;
  if (directEffectPending) return directEffectPending;
  const inputs = directEffectInputs;
  const pending = createLatestDirectEffectSession(inputs).then((session) => {
    if (directEffectInputs !== inputs) {
      session.close();
      throw new DOMException(
        "Direct replay replaced during initialization",
        "AbortError",
      );
    }
    directEffectSession = session;
    return session;
  });
  directEffectPending = pending;
  try {
    return await pending;
  } finally {
    if (directEffectPending === pending) directEffectPending = null;
  }
}
globalThis.replayEffectDiagnostics = Object.freeze({
  async startPerformanceRecording() {
    if (!report || !vfxRenderer?.ready)
      throw Error("Load a replay before recording spectator performance");
    if (spectatorRecording)
      throw Error("Stop the current performance recording first");
    const capturedReport = report;
    const [effectsManifestSha256, sceneManifestSha256] = await Promise.all([
      sha256(effectManifestBytes),
      sha256(sceneManifestBytes),
    ]);
    if (report !== capturedReport)
      throw Error("Replay changed before performance recording");
    if (spectatorRecording)
      throw Error("A performance recording started while hashing its inputs");
    const longTasksSupported =
      globalThis.PerformanceObserver?.supportedEntryTypes?.includes(
        "longtask",
      ) ?? false;
    spectatorGpuTimings = new LatestGpuTimings(renderer.getContext());
    spectatorRecording = new LatestSpectatorDiagnostics({
      build: report.build,
      protocol: report.protocol,
      replayHash: report.replaySha256,
      effectsManifestSha256,
      sceneManifestSha256,
      runtimeProgramVersion: DIRECT_EFFECT_PROGRAM_VERSION,
      runtime: "shared-retained-direct-effects",
      frameScheduling: "reply-driven-owned-presentations-v1",
      initialDisplayBoundary: lastDrawStamp
        ? structuredClone(lastDrawStamp)
        : null,
      longTasksSupported,
      gpuTimerSupported: !!spectatorGpuTimings.extension,
      comparisonWindow: [69, 99],
    });
    if (longTasksSupported) {
      spectatorLongTasks = new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          spectatorRecording?.longTask(entry);
      });
      spectatorLongTasks.observe({ type: "longtask" });
    }
    return structuredClone(spectatorRecording.contract);
  },
  stopPerformanceRecording() {
    if (!spectatorRecording)
      throw Error("No spectator performance recording is active");
    if (spectatorLongTasks) {
      for (const entry of spectatorLongTasks.takeRecords())
        spectatorRecording.longTask(entry);
      spectatorLongTasks.disconnect();
      spectatorLongTasks = null;
    }
    const result = spectatorRecording.finish({
      gpuTimings: spectatorGpuTimings.finish(),
    });
    spectatorGpuTimings = null;
    spectatorRecording = null;
    return result;
  },
  downloadPerformanceRecording() {
    const result =
      globalThis.replayEffectDiagnostics.stopPerformanceRecording();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "spectator-performance.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return result.contract;
  },
  async inspect() {
    if (directCaptureOwnership.blocksOrdinary(playing))
      throw Error("A direct diagnostic capture is already active");
    const token = playing ? null : directCaptureOwnership.acquire();
    try {
      const session = await directEffects();
      if (
        token
          ? !directCaptureOwnership.owns(token)
          : directCaptureOwnership.blocksOrdinary(playing)
      )
        throw Error(
          "Playback or diagnostic ownership changed before direct inspection",
        );
      await session.sample(time, camera);
      return await session.inspect();
    } finally {
      directCaptureOwnership.release(token);
    }
  },
  async captureCurrent() {
    if (playing) throw Error("Pause playback before capturing direct effects");
    const token = directCaptureOwnership.acquire();
    directReplyLoop?.invalidate();
    try {
      const session = await directEffects();
      if (!directCaptureOwnership.owns(token))
        throw Error("Playback changed before direct capture");
      const capturedTime = time;
      const capturedCamera = captureSynchronizedDirectView({
        updateWorld: () => applyWorldTime(),
        captureView: () => camera.clone(),
      });
      const presentation = await session.requestPresentation(
        capturedTime,
        capturedCamera,
      );
      camera.updateWorldMatrix(true, false);
      capturedCamera.updateWorldMatrix(true, false);
      if (
        !directCaptureOwnership.owns(token) ||
        !session.isPresentationCurrent(presentation) ||
        playing ||
        session !== directEffectSession ||
        time !== capturedTime ||
        !camera.matrixWorld.equals(capturedCamera.matrixWorld) ||
        !camera.projectionMatrix.equals(capturedCamera.projectionMatrix)
      )
        throw Error("Playback or camera changed before direct capture");
      const legacyVisible = vfxRenderer?.group.visible;
      session.renderer.commitDirect(presentation.packet, capturedCamera);
      if (vfxRenderer) vfxRenderer.group.visible = false;
      session.renderer.group.visible = true;
      let image;
      const drawCapture = beginDirectDrawCapture(
        presentation.packet,
        session.renderer,
        capturedCamera,
        { webglRenderer: renderer, scene },
      );
      try {
        drawScene(capturedCamera, "direct effect diagnostic", {
          record: false,
          directEffectRenderer: session.renderer,
        });
        image = renderer.domElement.toDataURL("image/png");
      } finally {
        drawCapture.stop();
        session.renderer.group.visible = false;
        if (vfxRenderer) vfxRenderer.group.visible = legacyVisible;
      }
      const drawSnapshot = structuredClone({
        requestId: presentation.requestId,
        time: presentation.packet.time,
        camera: presentation.camera,
        cameraWorld: capturedCamera.matrixWorld.toArray(),
        cameraProjection: capturedCamera.projectionMatrix.toArray(),
        coverage: presentation.packet.coverage,
        metrics: presentation.packet.metrics,
      });
      drawSnapshot.drawDiagnostics = await drawCapture.report();
      const diagnostics = await session.inspect();
      return {
        time: capturedTime,
        image,
        drawSnapshot,
        diagnostics,
        diagnosticsRelation: {
          scope: "latest session state observed after the captured draw",
          capturedReplayTime: capturedTime,
          latestWorkerReplayTime: diagnostics.worker.time,
          sameReplayTime: diagnostics.worker.time === capturedTime,
        },
      };
    } finally {
      directCaptureOwnership.release(token);
      directReplyLoop?.invalidate();
    }
  },
});
