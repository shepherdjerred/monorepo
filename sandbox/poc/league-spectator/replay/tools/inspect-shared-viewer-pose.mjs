// Actual provider sampling, not an additional rendering/engine-parity claim.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { loadLatestViewerPoseAssets } from "../latest-viewer-pose-assets.mjs";
import { createLatestWorldPresentation } from "../latest-world-presentation.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";
import { createLatestDirectEffectPlacement } from "../latest-direct-effect-placement.mjs";
import { createLatestViewerPoseAttachmentPlacement } from "../latest-viewer-pose-attachment.mjs";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { applyOriginalViewerPose } from "./viewer-pose-reference.mjs";
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
const session = await json(`${cache}/research/direct-session-control.json`);
for (const [path, digest] of Object.entries(session.inputs))
  if ((await sha256(await raw(path))) !== digest)
    throw Error(`Stale session: ${path}`);
const exported = await json(
  `${cache}/research/viewer-root-reconstruction.json`,
);
if (
  exported.kind !== "verified-ordinary-reconstruction-diagnostic-export" ||
  exported.runtimePlaybackInput !== false
)
  throw Error("Ordinary diagnostic export required");
const report = exported.report,
  scene = await json(`${cache}/public/latest-scene/manifest.json`),
  profile = await json(`${cache}/public/decoder-16.21-macos/profile.json`),
  heights = await load("latest-scene/heights.bin"),
  terrain = createLatestTerrain(
    scene,
    new Float32Array(
      heights.buffer,
      heights.byteOffset,
      heights.byteLength / 4,
    ),
  );
const assets = await loadLatestViewerPoseAssets({
    profile,
    report,
    scene,
    load,
  }),
  THREE = assets.THREE;
const selected = session.completeCoverage.rows.filter(
  (row) =>
    row.origin === "network-effect" &&
    row.time >= 69 &&
    row.time <= 99 &&
    row.runtimeActivated &&
    row.placementEvidence?.poseEvidence,
);
if (!selected.length) throw Error("Actual activated pose instances required");
const prepared = await loadLatestDirectEffectPackage({
    load,
    manifestBytes: await load("latest-effects/manifest.json"),
    effectIds: selected.map((row) => row.definitionId),
  }),
  packetPlacement = await createLatestDirectEffectPlacement({
    profile,
    packageBytes: await load("latest-world-descriptor-abi/package.json"),
  }),
  placement = createLatestViewerPoseAttachmentPlacement({
    profile,
    packetPlacement,
    definitions: prepared.definitions,
  });
const world = createLatestWorldPresentation({
    report,
    scene,
    terrain,
    viewerPoseAssets: assets,
    placementResolver: placement.resolve,
  }),
  rendered = new Map(),
  references = new Map();
let comparisons = 0,
  changedBoneControls = 0,
  independentMatrixLanes = 0;
function compareRendered(entityId, key, time, cursor) {
  let entry = rendered.get(entityId);
  if (!entry) {
    entry = assets.createEntry(entityId);
    world.bindViewerPoseActor(entityId, entry);
    rendered.set(entityId, entry);
    references.set(entityId, assets.createEntry(entityId));
  }
  const pose = world.viewerPose(entityId, [key], time, cursor);
  if (!pose.resolved) return { resolved: false, reasons: pose.reasons };
  const presented = world.presentViewerPose(entityId, time);
  if (!presented.resolved || presented.localPoseOnly)
    throw Error("Resolved causal pose lacks a comparable displayed pose");
  const entity = world.entity(entityId, time),
    reference = references.get(entityId);
  applyOriginalViewerPose(
    THREE,
    reference,
    time,
    entity.viewerMotion.moving,
    entity.viewerLifecycle,
    { position: entity.position },
    [entity.direction[0], entity.direction[2]],
  );
  for (let node = 0; node < entry.nodes.length; node++)
    for (let lane = 0; lane < 16; lane++) {
      independentMatrixLanes++;
      if (
        entry.nodes[node].matrixWorld.elements[lane] !==
        reference.nodes[node].matrixWorld.elements[lane]
      )
        throw Error(
          `Original planner matrix differs: ${entityId}:${time}:${node}:${lane}`,
        );
    }
  const position = new THREE.Vector3(),
    quaternion = new THREE.Quaternion(),
    scale = new THREE.Vector3(),
    matrix = new THREE.Matrix4();
  if (key) {
    const binding = assets
      .actor(entityId)
      .bindings.find((value) => value.resolvedBoneKey === key);
    matrix
      .copy(entry.group.parent.matrixWorld)
      .invert()
      .multiply(entry.jointMap.get(binding.name).node.matrixWorld);
    matrix.decompose(position, quaternion, scale);
  } else {
    position.copy(entry.group.position);
    quaternion.copy(entry.group.quaternion);
  }
  quaternion.normalize();
  matrix.makeRotationFromQuaternion(quaternion);
  const e = matrix.elements,
    expected = {
      position: position.toArray(),
      basis: [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]],
    },
    actual = pose.attachments[0];
  if (
    JSON.stringify(actual.position) !== JSON.stringify(expected.position) ||
    JSON.stringify(actual.basis) !== JSON.stringify(expected.basis)
  )
    throw Error(`Main/provider pose differs: ${entityId}:${key}:${time}`);
  comparisons++;
  return {
    resolved: true,
    position: actual.position,
    basis: actual.basis,
    poseEvidence: pose.poseEvidence,
  };
}
const rows = [];
for (const row of selected) {
  const d = report.effectDescriptors.find(
    (value) => value.creationSequence === row.entryOrder,
  );
  if (
    !d ||
    d.entityId !== row.entityId ||
    d.time !== row.time ||
    d.transportSequence !== row.transportSequence
  )
    throw Error("Exact activated source identity required");
  const event = {
      id: row.id,
      origin: "network-effect",
      definitionId: row.definitionId,
      descriptor: d,
    },
    creationCursor = {
      transportSequence: d.transportSequence,
      entryOrder: d.creationSequence,
    },
    samples = [];
  for (let frame = 0; frame <= 30; frame++) {
    const time = row.time + frame / 60,
      cursor = frame === 0 ? creationCursor : null,
      placed = world.placement(event, time, cursor),
      queries = [];
    if (placed.resolved) {
      for (const [entityId, key] of [
        [d.attachmentEntityId, d.attachmentKey4c],
        [d.lookup14EntityId, d.attachmentKey50],
      ])
        if (entityId)
          queries.push({
            entityId,
            key,
            ...compareRendered(entityId, key, time, cursor),
          });
    }
    samples.push({
      frame,
      time,
      resolved: placed.resolved,
      position: placed.position ?? null,
      basis: placed.basis ?? null,
      secondaryPosition: placed.secondaryPosition ?? null,
      reasons: placed.reasons,
      queries,
    });
  }
  const first = world.placement(event, row.time, creationCursor);
  if (
    !first.resolved ||
    JSON.stringify(first.poseEvidence) !==
      JSON.stringify(row.placementEvidence.poseEvidence)
  )
    throw Error("Initial runtime pose evidence differs from shared provider");
  for (let frame = 0; frame <= 30; frame += 4) {
    const time = row.time + frame / 60,
      cursor = frame === 0 ? creationCursor : null,
      placed = world.placement(event, time, cursor),
      expected = samples[frame];
    if (
      placed.resolved !== expected.resolved ||
      JSON.stringify(placed.position ?? null) !==
        JSON.stringify(expected.position) ||
      JSON.stringify(placed.basis ?? null) !== JSON.stringify(expected.basis) ||
      JSON.stringify(placed.secondaryPosition ?? null) !==
        JSON.stringify(expected.secondaryPosition)
    )
      throw Error("1x/4x provider samples diverge");
  }
  const bones = new Map();
  for (const sample of samples)
    for (const query of sample.queries)
      if (query.key) {
        const set = bones.get(`${query.entityId}:${query.key}`) ?? new Set();
        set.add(JSON.stringify(query.position));
        bones.set(`${query.entityId}:${query.key}`, set);
      }
  const moved = [...bones.values()].some((values) => values.size > 1);
  if (moved) changedBoneControls++;
  rows.push({
    sourceEventId: row.id,
    definitionId: row.definitionId,
    boneMotionObserved: moved,
    samples,
  });
}
if (independentMatrixLanes === 0)
  throw Error("Independent original planner matrix comparisons required");
if (changedBoneControls === 0)
  throw Error("Actual continuous bone motion must be nonzero");
const initialHero = report.heroes.find((hero) => hero.champion === "Ornn"),
  initialUnknown = world.viewerPose(initialHero.entityId, [0], 0);
if (
  initialUnknown.resolved ||
  !initialUnknown.reasons.includes("pose:viewer-actor-orientation-unresolved")
)
  throw Error("Unknown initial orientation became an attachment basis");
const form = report.resourceRequests.find((request) =>
    report.heroes.some((hero) => hero.entityId === request.entityId),
  ),
  formUnknown = world.viewerPose(form.entityId, [0], form.time, {
    transportSequence: form.transportSequence,
    entryOrder: form.entryOrder,
  });
if (
  formUnknown.resolved ||
  !formUnknown.reasons.includes("pose:untranslated-appearance-or-form-request")
)
  throw Error("Actual untranslated form request did not invalidate pose");
const death = report.lifecycle.find(
    (event) =>
      event.kind === "death-candidate" &&
      event.time <= 99 &&
      report.heroes.some((hero) => hero.entityId === event.entityId),
  ),
  deadUnknown = world.viewerPose(death.entityId, [0], death.time, {
    transportSequence: death.transportSequence,
    entryOrder: death.entryOrder ?? 0,
  });
if (
  deadUnknown.resolved ||
  !deadUnknown.reasons.includes(
    "pose:provider-death-revive-lifecycle-unimplemented",
  )
)
  throw Error("Actual provider death did not invalidate pose");
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error(`Final input drift: ${path}`);
const output = resolve(cache, "research/shared-viewer-pose-control.json");
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "actual-shared-viewer-pose-continuous-control",
      presentationContentHash: assets.contentHash,
      instances: rows.length,
      definitions: new Set(rows.map((row) => row.definitionId)).size,
      normalActorProviderComparisons: comparisons,
      independentOriginalPlannerMatrixLanes: independentMatrixLanes,
      independentOriginalPlannerMatrixMismatches: 0,
      changedBoneControls,
      actualUnknownControls: {
        initialOrientation: {
          entityId: initialHero.entityId,
          time: 0,
          result: initialUnknown,
        },
        form: { sourceEventId: form.id, result: formUnknown },
        death: {
          entityId: death.entityId,
          time: death.time,
          transportSequence: death.transportSequence,
          result: deadUnknown,
        },
      },
      controls: {
        actualBirthEvidenceMatchesRuntime: true,
        oneXFourXCommonTimes: true,
        backwardRestoration: true,
        separateCausalAndDisplayedHierarchies: true,
        originalHistoricalEventPlannerMatchesAllJointMatrices: true,
        unknownStatesRemainOmitted: true,
      },
      rows,
      inputs,
      scope: {
        actualDecodedRequests: true,
        actualInstalledStaticAssets: true,
        providerSamplingWindowSeconds: 0.5,
        providerSamplingBeyondParticleLifetimePossible: true,
        particleTimelineVerifiedBySeparateWorkerProof: true,
        browserActorRenderingObserved: false,
        nativeAcceptance: null,
        nativePoseParity: null,
        completeEffectFidelity: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    instances: rows.length,
    definitions: new Set(rows.map((row) => row.definitionId)).size,
    normalActorProviderComparisons: comparisons,
    independentOriginalPlannerMatrixLanes: independentMatrixLanes,
    changedBoneControls,
    inputs: Object.keys(inputs).length,
  }),
);
