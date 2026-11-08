// Data/asset inspection only. Does not run a browser or claim rendered fidelity.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { bindLatestBuildings, bindLatestMinions } from "../latest-world.mjs";
import {
  prepareLatestLifecycle,
  sampleLatestLifecycle,
} from "../latest-lifecycle.mjs";
import { prepareLatestMovement } from "../latest-movement.mjs";
import { sampleMovement } from "../playback.mjs";
import { loadAnimationPoses } from "./load-animation-poses.mjs";

const [reportPath, scenePath, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-latest-world.mjs <decoded-semantics.json> <static-scene-dir> <evidence.json>",
  );
const root = resolve(scenePath),
  report = await Bun.file(reportPath).json(),
  manifest = await Bun.file(`${root}/manifest.json`).json(),
  catalog = await Bun.file(`${root}/${manifest.world}`).json(),
  bindings = bindLatestBuildings(report, manifest, catalog),
  minionBindings = bindLatestMinions(report, manifest, catalog),
  lifecycle = prepareLatestLifecycle(report),
  movement = prepareLatestMovement(report, manifest.map),
  assets = {},
  animationPoses = await loadAnimationPoses(root);
const hash = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const { PropertyBinding } = await import(
  pathToFileURL(resolve(root, "../vendor/three.module.js")).href
);
for (const key of new Set([
  ...bindings.map((b) => b.object.asset),
  ...minionBindings.minions.map((m) => m.unit.asset),
])) {
  const asset = catalog.assets[key],
    bytes = Buffer.from(await Bun.file(`${root}/${asset.model}`).arrayBuffer());
  if (
    bytes.readUInt32LE(0) !== 0x46546c67 ||
    bytes.readUInt32LE(4) !== 2 ||
    bytes.readUInt32LE(8) !== bytes.length ||
    bytes.readUInt32LE(16) !== 0x4e4f534a
  )
    throw Error(`Invalid GLB ${key}`);
  const gltf = JSON.parse(
      bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString(),
    ),
    hidden = new Set(asset.hidden.map((s) => s.toLowerCase())),
    unsupported = new Set(
      Object.keys(asset.unsupportedMaterials).map((s) => s.toLowerCase()),
    ),
    materials = gltf.materials.map((m) => m.name),
    visible = materials.filter(
      (m) => !hidden.has(m.toLowerCase()) && !unsupported.has(m.toLowerCase()),
    ),
    visibleGeometry = gltf.meshes
      .flatMap((m) => m.primitives)
      .filter((p) => visible.includes(materials[p.material]));
  if (
    !visibleGeometry.length ||
    (!asset.animationCatalog && gltf.animations?.length)
  )
    throw Error(`Unexpected building pose/material package ${key}`);
  const bounds = visibleGeometry.map((p) => {
    const a = gltf.accessors[p.attributes.POSITION];
    if (!a.min?.every(Number.isFinite) || !a.max?.every(Number.isFinite))
      throw Error(`Missing finite model bounds ${key}`);
    return {
      min: a.min.map((v) => v * asset.scale),
      max: a.max.map((v) => v * asset.scale),
    };
  });
  assets[key] = {
    model: asset.model,
    sha256: hash(bytes),
    bytes: bytes.length,
    scale: asset.scale,
    hidden: asset.hidden,
    visibleMaterials: visible,
    localPositionBounds: bounds,
    poseStatus: asset.poseStatus,
  };
  if (asset.animationCatalog) {
    const poseBinding = await animationPoses.bind(asset),
      c = poseBinding.catalog,
      graph = poseBinding.graph;
    for (const joint of c.joints) {
      const name = PropertyBinding.sanitizeNodeName(joint);
      if (
        gltf.nodes.filter(
          (node) =>
            node.name && PropertyBinding.sanitizeNodeName(node.name) === name,
        ).length !== 1
      )
        throw Error(`Unbound/ambiguous exported minion joint ${key}/${joint}`);
    }
    assets[key].animationBindings = {};
    for (const name of [
      asset.previewClips.idle,
      asset.previewClips.run,
      "Death",
    ]) {
      const result = graph.evaluate(name, 0.01, { moving: false });
      if (result.unresolved.length || !result.leaves.length)
        throw Error(`Unresolved minion preview ${key}/${name}`);
      for (const layer of result.leaves) {
        const pose = await poseBinding.read(layer.file);
        if (pose.tracks.some((t) => c.joints[t.jointId] !== t.bone))
          throw Error("Minion animation/skeleton mismatch");
      }
      assets[key].animationBindings[name] = {
        duration: result.duration,
        files: result.leaves.map((l) => l.file),
      };
    }
  }
}
const npcSkins = {};
for (const event of report.worldEvents.filter(
  (e) => e.kind === "npc-creation-candidate",
)) {
  if (!Number.isInteger(event.skinId))
    throw Error("NPC skin argument has not been decoded");
  const key = `${event.character}/${event.skinId}`;
  npcSkins[key] = (npcSkins[key] ?? 0) + 1;
}
const evidence = {
  schema: 1,
  build: report.build,
  protocol: report.protocol,
  replaySha256: report.replaySha256,
  semanticsSha256: hash(await Bun.file(reportPath).arrayBuffer()),
  catalogSha256: hash(
    await Bun.file(`${root}/${manifest.world}`).arrayBuffer(),
  ),
  scope:
    "Decoded identity/static asset binding and GLB structure only; browser render and native A/V comparison not performed",
  bindings: bindings.map((b) => ({
    entityId: b.event.entityId,
    name: b.event.name,
    time: b.event.time,
    recordedTeam: b.event.team,
    mapNameHash: b.event.mapNameHash,
    sourceName: b.object.sourceName,
    asset: b.object.asset,
    transform: b.object.transform,
  })),
  assets,
  minionRegistry: {
    status: minionBindings.status,
    registrationBase: minionBindings.registrationBase,
    anchors: minionBindings.anchors,
  },
  minions: minionBindings.minions.map((m) => {
    const intervals = lifecycle.tracks.get(m.event.entityId) ?? [];
    return {
      entityId: m.event.entityId,
      time: m.event.time,
      barracksId: m.event.barracksId,
      barracksKey: m.barracks.objectKey,
      asset: m.unit.asset,
      unitType: m.event.unitType,
      modelRecords: m.unit.records,
      deathTimes: intervals.map((i) => i.death.time),
      samples: [m.event.time, 60, 90, 120]
        .filter((t) => t >= m.event.time && t <= report.endTime)
        .map((time) => {
          const life = sampleLatestLifecycle(intervals, time),
            state = sampleMovement(
              movement.tracks.get(m.event.entityId),
              life.dead ? life.interval.death.time : time,
            );
          return {
            time,
            dead: life.dead,
            point: state?.point ?? [
              m.creationPosition[0],
              m.creationPosition[2],
            ],
            sourceSequence: state?.event.sequence ?? null,
          };
        }),
    };
  }),
  heroLifetimes: report.heroes.flatMap((h) =>
    (lifecycle.tracks.get(h.entityId) ?? []).map((i) => ({
      champion: h.champion,
      entityId: h.entityId,
      death: i.death.time,
      killerId: i.death.killerId,
      respawn: i.respawn?.time ?? null,
      respawnPoint: i.respawn?.point ?? null,
      respawnSeconds: i.death.respawnSeconds,
      actualInterval: i.respawn ? i.respawn.time - i.death.time : null,
      postDeathCasts: i.postDeathActions.length,
    })),
  ),
  repeatedDeathNotifications: lifecycle.repeatedDeaths.length,
  unmatchedRespawns: lifecycle.unmatchedRespawns.length,
  npcSkins,
  limitations: catalog.limitations,
};
await Bun.write(outputPath, JSON.stringify(evidence, null, 2));
console.log(
  JSON.stringify({
    build: report.build,
    buildings: bindings.length,
    assets: Object.keys(assets).length,
    minions: minionBindings.minions.length,
    heroDeaths: report.summary.heroDeaths,
    npcSkinBindings: Object.keys(npcSkins).length,
    scope: evidence.scope,
  }),
);
