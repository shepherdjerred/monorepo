// Actual installed hierarchy/clip controls. No runtime input is emitted.
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { createLatestViewerPoseSampler } from "../latest-viewer-pose-sampler.mjs";
import { createLatestAnimationPoses } from "../latest-animation-poses.mjs";
import { createLatestAnimationRigBindings } from "../latest-animation-rigs.mjs";
import {
  createAnimationGraph,
  readAnimationAsset,
  sampleAnimationFrame,
} from "../latest-animation.mjs";
import { resolveCombatPresentation } from "../latest-combat.mjs";
import { createLatestWorldPresentation } from "../latest-world-presentation.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";
import { prepareLatestMovement } from "../latest-movement.mjs";
import { sampleMovement } from "../playback.mjs";
import {
  prepareLatestLifecycle,
  sampleLatestLifecycle,
  sampleLatestDeathPosePreview,
} from "../latest-lifecycle.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    digest = await sha256(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Input drift: ${path}`);
  inputs[path] = digest;
  return bytes;
}
const json = async (path) =>
    JSON.parse(new TextDecoder().decode(await raw(path))),
  load = (path) => raw(`${cache}/public/${path}`);
await captureDirectSourceInputs(
  [
    import.meta.path,
    fileURLToPath(new URL("../latest-viewer.mjs", import.meta.url)),
  ],
  raw,
);
const ranking = await json(
  `${cache}/research/viewer-pose-frontier-ranking.json`,
);
for (const [path, digest] of Object.entries(ranking.inputs))
  if ((await sha256(await raw(path))) !== digest)
    throw Error(`Stale ranking: ${path}`);
const exported = await json(
    `${cache}/research/viewer-root-reconstruction.json`,
  ),
  report = exported.report;
const profile = await json(`${cache}/public/decoder-16.21-macos/profile.json`),
  scene = await json(`${cache}/public/latest-scene/manifest.json`),
  heights = await load("latest-scene/heights.bin");
const world = createLatestWorldPresentation({
  report,
  scene,
  terrain: createLatestTerrain(
    scene,
    new Float32Array(
      heights.buffer,
      heights.byteOffset,
      heights.byteLength / 4,
    ),
  ),
});
const poses = await createLatestAnimationPoses(
  profile,
  await load("decoder-16.21-macos/animation-clock.json"),
  await load("latest-animation-poses/manifest.json"),
);
const rigBytes = await load("decoder-16.21-macos/animation-rigs.json"),
  rigs = JSON.parse(new TextDecoder().decode(rigBytes)),
  rigFactory = await createLatestAnimationRigBindings(profile, rigBytes);
await raw(`${cache}/public/vendor/three.module.js`);
const THREE = await import(
  pathToFileURL(`${cache}/public/vendor/three.module.js`).href
);
const movement = prepareLatestMovement(report, scene.map).tracks,
  lifecycle = prepareLatestLifecycle(report).tracks,
  heroes = new Map(report.heroes.map((hero) => [hero.entityId, hero]));
const selected = ranking.rows.filter(
    (row) =>
      row.components.length &&
      row.quadComponentIds.length &&
      !row.remainingDependencies.length,
  ),
  actors = new Map();
function hierarchy(bytes, asset, catalog) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.length ||
    view.getUint32(16, true) !== 0x4e4f534a
  )
    throw Error("Exact GLB2 node source required");
  const model = JSON.parse(
      new TextDecoder().decode(
        bytes.subarray(20, 20 + view.getUint32(12, true)),
      ),
    ),
    nodes = model.nodes.map((source, index) => {
      const node = new THREE.Object3D();
      node.name = THREE.PropertyBinding.sanitizeNodeName(
        source.name ?? `node_${index}`,
      );
      if (source.matrix) {
        node.matrix.fromArray(source.matrix);
        node.matrix.decompose(node.position, node.quaternion, node.scale);
      } else {
        if (source.translation) node.position.fromArray(source.translation);
        if (source.rotation) node.quaternion.fromArray(source.rotation);
        if (source.scale) node.scale.fromArray(source.scale);
      }
      return node;
    });
  const assigned = new Set();
  for (const [sourceIndex, source] of model.nodes.entries())
    for (const child of source.children ?? []) {
      if (!nodes[child] || assigned.has(child))
        throw Error(
          "Instanced/invalid GLB hierarchy is outside this static control",
        );
      assigned.add(child);
      nodes[sourceIndex].add(nodes[child]);
    }
  const mirror = new THREE.Group(),
    group = new THREE.Group(),
    modelScene = new THREE.Group();
  mirror.scale.z = -1;
  mirror.add(group);
  group.add(modelScene);
  modelScene.scale.setScalar(asset.scale);
  for (const index of model.scenes[model.scene ?? 0].nodes) {
    if (assigned.has(index)) throw Error("GLB scene root has a node parent");
    modelScene.add(nodes[index]);
  }
  const jointMap = new Map();
  for (const name of catalog.joints) {
    const matches = nodes.filter(
      (node) => node.name === THREE.PropertyBinding.sanitizeNodeName(name),
    );
    if (matches.length !== 1)
      throw Error(`Ambiguous GLB catalog joint: ${name}`);
    const node = matches[0];
    jointMap.set(name, {
      node,
      position: node.position.clone(),
      quaternion: node.quaternion.clone(),
      scale: node.scale.clone(),
    });
  }
  return { group, jointMap, nodes, mirror };
}
async function actor(entityId) {
  if (actors.has(entityId)) return actors.get(entityId);
  const hero = heroes.get(entityId);
  if (!hero)
    throw Error("Only actual installed champion actors in this control");
  const asset =
      scene.champions[`${hero.champion.toLowerCase()}/${hero.skinId}`],
    graphBytes = await load(`latest-scene/${asset.animationGraph}`),
    catalogBytes = await load(`latest-scene/${asset.animationCatalog}`),
    modelBytes = await load(`latest-scene/${asset.model}`);
  const bound = await poses.bind(
      asset.animationGraph,
      graphBytes,
      catalogBytes,
    ),
    graph = createAnimationGraph(
      JSON.parse(new TextDecoder().decode(graphBytes)),
      bound.catalog,
      bound.clock,
    ),
    spellCatalog = await json(
      `${cache}/public/latest-scene/${asset.spellCatalog}`,
    );
  const events = [
    ...report.animations
      .filter((event) => event.entityId === entityId)
      .map((event) => ({
        ...event,
        rate: event.scalar20,
        sourceKind: "animation-name",
      })),
    ...resolveCombatPresentation(
      {
        character: hero.champion,
        entityId,
        characterRecords: asset.characterRecords,
      },
      spellCatalog,
      report,
    ).actions,
  ].sort((a, b) => a.time - b.time || a.sequence - b.sequence);
  const files = new Set([
      bound.catalog.clips[asset.previewClips.idle].file,
      bound.catalog.clips[asset.previewClips.run].file,
      ...graph.dependencies("Death"),
      ...events.flatMap((event) => graph.dependencies(event.name)),
    ]),
    poseAssets = new Map();
  for (const file of files) {
    const bytes = await load(
      `latest-animation-poses/${bound.directory}/${file}`,
    );
    if ((await sha256(bytes)) !== bound.expectedFileHash(file))
      throw Error("Static clip differs from pinned pose package");
    poseAssets.set(
      file,
      readAnimationAsset(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
      ),
    );
  }
  const rig = rigs.graphs[asset.animationGraph],
    rigBinding = await rigFactory.bind(
      asset.animationGraph,
      await load(`latest-scene/${rig.rigFile}`),
      catalogBytes,
    ),
    bindings = rig.bindings.map((binding) => rigBinding.resolve(binding.name));
  const make = () => ({
    ...hierarchy(modelBytes, asset, bound.catalog),
    catalog: bound.catalog,
    graph,
    poseAssets,
    previewNames: asset.previewClips,
    events,
  });
  const entry = make(),
    control = make(),
    sampler = createLatestViewerPoseSampler({
      THREE,
      entry,
      entityId,
      bindings,
    });
  const value = { entry, control, sampler, hero, asset, files: files.size };
  actors.set(entityId, value);
  return value;
}
// Independent copy of the existing viewer's normal-frame pose application.
// It deliberately keeps its sequence ordering; causal request sampling is tested
// separately and never compared to a future-inclusive normal frame.
function originalViewer(entry, time, moving, life, root, direction) {
  const qa = new THREE.Quaternion(),
    qb = new THREE.Quaternion(),
    va = new THREE.Vector3(),
    vb = new THREE.Vector3();
  const apply = (layer) => {
    const pose = entry.poseAssets.get(layer.file);
    for (const track of pose.tracks) {
      const amount =
        (layer.weights ? layer.weights[track.jointId] : 1) * layer.weight;
      if (amount === 0) continue;
      const node = entry.jointMap.get(track.bone).node,
        sample = sampleAnimationFrame(
          track,
          layer.sourceFrame ?? layer.phase * pose.fps,
        );
      if (track.channel === "quaternion") {
        qa.fromArray(sample.a);
        qb.fromArray(sample.b);
        qa.slerp(qb, sample.fraction);
        node.quaternion.slerp(qa, amount);
      } else {
        va.fromArray(sample.a);
        vb.fromArray(sample.b);
        va.lerp(vb, sample.fraction);
        node[track.channel].lerp(va, amount);
      }
    }
  };
  entry.group.position.fromArray(root.position);
  entry.group.rotation.y = Math.atan2(direction[0], direction[1]);
  for (const joint of entry.jointMap.values()) {
    joint.node.position.copy(joint.position);
    joint.node.quaternion.copy(joint.quaternion);
    joint.node.scale.copy(joint.scale);
  }
  const death = sampleLatestDeathPosePreview(entry.graph, life, time);
  if (death) {
    for (const leaf of death.leaves) apply(leaf);
  } else {
    const name = entry.previewNames[moving ? "run" : "idle"],
      initial = entry.graph.evaluate(name, 0, { moving });
    for (const leaf of entry.graph.evaluate(name, time % initial.duration, {
      moving,
    }).leaves)
      apply(leaf);
    const layers = new Map();
    for (const event of entry.events) {
      if (event.time > time) break;
      for (const leaf of entry.graph.evaluate(event.name, 0, { moving }).leaves)
        layers.set(leaf.track, event);
    }
    const active = [];
    for (const [track, event] of layers) {
      if (event.rate <= 0) continue;
      for (const leaf of entry.graph.evaluate(
        event.name,
        (time - event.time) * event.rate,
        { moving },
      ).leaves)
        if (leaf.track === track) active.push({ ...leaf, event });
    }
    active.sort(
      (a, b) =>
        b.priority - a.priority ||
        a.event.time - b.event.time ||
        a.event.sequence - b.event.sequence,
    );
    for (const leaf of active) {
      apply(leaf);
      if (leaf.event.sourceKind === "attack") {
        const target = leaf.event.sourceEvent.targetPosition,
          dx = target[0] - root.position[0],
          dz = target[2] - root.position[2];
        if ((target[0] !== 0 || target[2] !== 0) && Math.hypot(dx, dz) > 0.001)
          entry.group.rotation.y = Math.atan2(dx, dz);
      }
    }
  }
  entry.group.updateWorldMatrix(true, true);
}
function actualInput(entityId, keys, time, cursor) {
  const life = sampleLatestLifecycle(lifecycle.get(entityId), time),
    motion = sampleMovement(
      movement.get(entityId),
      life.dead ? life.interval.death.time : time,
    ),
    entity = world.entity(entityId, time, cursor),
    root = world.viewerRoot(entityId, time, cursor);
  // Keep this first actual control bounded to live actors with the SAME decoded
  // motion record selected in normal rendering and the causal world adapter.
  // Death/post-death lookahead and different same-time motion owners need their
  // own shared lifecycle adapter before a production pose provider can use them.
  if (
    life.dead ||
    !motion ||
    entity?.positionSource?.kind !== "movement" ||
    entity.positionSource.sequence !== motion.event.sequence
  )
    throw Error(
      "This actual pose control requires a live actor with matching causal/normal movement ownership",
    );
  return {
    time,
    cursor,
    root,
    viewerYawInput: {
      status: entity.orientationStatus,
      direction: entity.direction
        ? [entity.direction[0], entity.direction[2]]
        : null,
      source: entity.positionSource,
    },
    moving: motion.moving,
    life,
    attachmentKeys: [...keys],
  };
}
const rows = [];
let comparedMatrixLanes = 0;
for (const candidate of selected) {
  const descriptor = report.effectDescriptors.find(
    (value) =>
      `network-effect:${value.entityId}:${value.creationSequence}` ===
      candidate.sourceEventId,
  );
  if (!descriptor) throw Error("Actual creation descriptor missing");
  const cursor = {
      transportSequence: descriptor.transportSequence,
      entryOrder: descriptor.creationSequence,
    },
    queries = new Map();
  for (const ref of [candidate.source, candidate.target])
    if (ref.entityId) {
      const keys = queries.get(ref.entityId) ?? new Set();
      keys.add(ref.key);
      queries.set(ref.entityId, keys);
    }
  const results = [];
  for (const [entityId, keys] of queries) {
    const value = await actor(entityId),
      input = actualInput(entityId, keys, candidate.time, cursor);
    const sampled = value.sampler.sample(input),
      normalRoot = world.viewerRoot(entityId, candidate.time),
      normalEntity = world.entity(entityId, candidate.time),
      normalYaw = {
        status: normalEntity.orientationStatus,
        direction: normalEntity.direction
          ? [normalEntity.direction[0], normalEntity.direction[2]]
          : null,
        source: normalEntity.positionSource,
      };
    const normal = value.sampler.sample({
      ...input,
      cursor: null,
      root: normalRoot,
      viewerYawInput: normalYaw,
    });
    let maxMatrixError = null;
    if (normal.resolved) {
      originalViewer(
        value.control,
        candidate.time,
        input.moving,
        input.life,
        normalRoot,
        normalYaw.direction,
      );
      maxMatrixError = 0;
      for (let index = 0; index < value.entry.nodes.length; index++)
        for (let lane = 0; lane < 16; lane++) {
          maxMatrixError = Math.max(
            maxMatrixError,
            Math.abs(
              value.entry.nodes[index].matrixWorld.elements[lane] -
                value.control.nodes[index].matrixWorld.elements[lane],
            ),
          );
          comparedMatrixLanes++;
        }
      if (maxMatrixError !== 0)
        throw Error(
          `Viewer matrix mismatch: ${candidate.sourceEventId}:${entityId}:${maxMatrixError}`,
        );
    }
    const earlier = actualInput(entityId, keys, candidate.time - 0.5, null),
      earlierSample = value.sampler.sample(earlier);
    if (!earlierSample.resolved)
      throw Error("Earlier actual viewer-pose sample is unresolved");
    const restored = value.sampler.sample(input);
    if (JSON.stringify(restored) !== JSON.stringify(sampled))
      throw Error("Backward pose query changed absolute-time output");
    results.push({
      entityId,
      keys: [...keys],
      sampled,
      normalFrameResolved: normal.resolved,
      maxMatrixError,
      backwardRestoredAfterActualEarlierTime: earlier.time,
      staticClipFiles: value.files,
    });
  }
  rows.push({
    sourceEventId: candidate.sourceEventId,
    definitionId: candidate.definitionId,
    time: candidate.time,
    resolved: results.every((value) => value.sampled.resolved),
    queries: results,
  });
}
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error(`Final input drift: ${path}`);
const output = resolve(cache, "research/viewer-pose-samples-control.json");
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "actual-installed-viewer-pose-sampler-control",
      candidateRequests: rows.length,
      resolvedRequests: rows.filter((row) => row.resolved).length,
      actorCount: actors.size,
      comparedMatrixLanes,
      normalFrameMatrixMismatches: 0,
      rows,
      inputs,
      scope: {
        actualDecodedRequestTimes: true,
        actualInstalledGLBNodeHierarchy: true,
        actualPinnedClipsAndGraphClock: true,
        aliveActorsAndMatchingCausalMotionOnly: true,
        backwardRestoredAfterActualEarlierWorldInputs: true,
        originalViewerNormalFrameMathCompared: true,
        browserActorRenderingObserved: false,
        productionWorldProviderIntegrated: false,
        nativePoseParity: null,
        nativeAcceptance: null,
        runtimeActivationChanged: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    candidateRequests: rows.length,
    resolvedRequests: rows.filter((row) => row.resolved).length,
    actorCount: actors.size,
    comparedMatrixLanes,
    inputs: Object.keys(inputs).length,
  }),
);
