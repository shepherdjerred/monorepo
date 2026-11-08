// Inventory only: installed rig identities do not establish an entity pose.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "../structural-comparison.mjs";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { createLatestAnimationRigBindings } from "../latest-animation-rigs.mjs";
import { createLatestWorldPresentation } from "../latest-world-presentation.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

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
  JSON.parse(new TextDecoder().decode(await raw(path)));
const load = (path) => raw(`${cache}/public/${path}`);
await captureDirectSourceInputs(
  [
    import.meta.path,
    fileURLToPath(new URL("../latest-viewer.mjs", import.meta.url)),
  ],
  raw,
);
const exported = await json(
  `${cache}/research/viewer-root-reconstruction.json`,
);
if (
  exported.kind !== "verified-ordinary-reconstruction-diagnostic-export" ||
  exported.runtimePlaybackInput !== false
)
  throw Error("Ordinary diagnostic export required");
for (const [path, digest] of Object.entries(exported.inputs))
  if ((await sha256(await raw(path))) !== digest)
    throw Error(`Stale ordinary export: ${path}`);
const { report } = exported,
  session = await json(`${cache}/research/direct-session-control.json`);
for (const [path, digest] of Object.entries(session.inputs))
  if ((await sha256(await raw(path))) !== digest)
    throw Error(`Stale session evidence: ${path}`);
for (const row of session.completeCoverage.rows)
  if (row.resourceResolved && typeof row.placementResolved !== "boolean")
    throw Error(
      "Current placement/component world-input stage contract required",
    );
const candidates = session.completeCoverage.rows.filter(
  (row) =>
    row.origin === "network-effect" &&
    row.time >= 69 &&
    row.time <= 99 &&
    row.resourceResolved &&
    !row.placementResolved,
);
const prepared = await loadLatestDirectEffectPackage({
  load,
  manifestBytes: await load("latest-effects/manifest.json"),
  effectIds: candidates.map((row) => row.definitionId),
});
const profile = await json(`${cache}/public/decoder-16.21-macos/profile.json`),
  rigBytes = await load("decoder-16.21-macos/animation-rigs.json"),
  rigs = JSON.parse(new TextDecoder().decode(rigBytes));
const rigFactory = await createLatestAnimationRigBindings(profile, rigBytes);
const scene = await json(`${cache}/public/latest-scene/manifest.json`),
  height = await load("latest-scene/heights.bin");
const terrain = createLatestTerrain(
  scene,
  new Float32Array(height.buffer, height.byteOffset, height.byteLength / 4),
);
const world = createLatestWorldPresentation({ report, scene, terrain });
const heroes = new Map(report.heroes.map((hero) => [hero.entityId, hero])),
  descriptors = new Map(
    report.effectDescriptors.map((d) => [d.creationSequence, d]),
  );
const assets = new Map();
for (const hero of report.heroes) {
  const actorKey = `${hero.champion.toLowerCase()}/${hero.skinId}`,
    asset = scene.champions[actorKey],
    graph = rigs.graphs[asset?.animationGraph];
  if (!asset || !graph) throw Error(`Missing equipped viewer rig: ${actorKey}`);
  const binding = await rigFactory.bind(
    asset.animationGraph,
    await load(`latest-scene/${graph.rigFile}`),
    await load(`latest-scene/${graph.catalogFile}`),
  );
  const byKey = new Map();
  for (const item of graph.bindings) {
    const native = binding.resolve(item.name);
    if (native.status !== "rig-joint")
      throw Error("Static rig name is unresolved");
    const values = byKey.get(item.resolvedBoneKey) ?? [];
    values.push(native);
    byKey.set(item.resolvedBoneKey, values);
  }
  assets.set(hero.entityId, { actorKey, asset, graph, byKey });
}
function attachment(entityId, key, time, cursor) {
  if (!entityId) return { entityId, key, status: "native-null" };
  const entity = world.entity(entityId, time, cursor),
    hero = heroes.get(entityId),
    asset = assets.get(entityId);
  if (!entity)
    return { entityId, key, status: "unresolved-or-inactive-entity" };
  if (!hero)
    return {
      entityId,
      key,
      entityClass: entity.entityClass,
      status: "viewer-actor-rig-not-in-this-champion-inventory",
    };
  const root = world.viewerRoot(entityId, time, cursor),
    keys = key ? (asset.byKey.get(key) ?? []) : [];
  const indices = [...new Set(keys.map((value) => value.keyPoseIndex))];
  return {
    entityId,
    key,
    actorKey: asset.actorKey,
    status: !root.resolved
      ? "viewer-root-unresolved"
      : key === 0
        ? "viewer-root-input"
        : indices.length === 1
          ? "installed-key-mapped-pose-unresolved"
          : indices.length
            ? "ambiguous-installed-key"
            : "installed-key-absent",
    position: root.position ?? null,
    rootSource: root.source ?? root.positionSource ?? null,
    orientationInputStatus: entity.orientationStatus,
    names: keys.map((value) => value.name),
    nativePoseIndices: indices,
    viewerCatalogIndices: [
      ...new Set(keys.map((value) => value.poseJointIndex)),
    ],
    graph: asset.asset.animationGraph,
    scale: asset.asset.scale,
    nativeAcceptance: null,
    nativePoseParity: null,
  };
}
const rows = [];
for (const coverage of candidates) {
  const d = descriptors.get(coverage.entryOrder),
    definition = prepared.definitions.get(coverage.definitionId);
  if (
    !d ||
    d.entityId !== coverage.entityId ||
    d.transportSequence !== coverage.transportSequence ||
    d.time !== coverage.time
  )
    throw Error("Exact creation identity required");
  const cursor = {
    transportSequence: d.transportSequence,
    entryOrder: d.creationSequence,
  };
  const source = attachment(
      d.attachmentEntityId,
      d.attachmentKey4c,
      d.time,
      cursor,
    ),
    target = attachment(d.lookup14EntityId, d.attachmentKey50, d.time, cursor);
  const remaining = [];
  if (definition.blockers.length) remaining.push(...definition.blockers);
  for (const [field, id] of Object.entries(coverage.entityReferences))
    if (id && !world.entity(id, d.time, cursor))
      remaining.push(`reference:${field}:${id}`);
  if (d.field8c) remaining.push("nonordinary-factory");
  if (d.byteFields.field98) remaining.push("special-source-provider");
  if (d.flags & ~0xb0) remaining.push(`placement-flags:${d.flags & ~0xb0}`);
  if (d.vector6c[1] !== 0) remaining.push("nonhorizontal-authored-direction");
  if (d.lookupA8EntityId && d.lookupA8EntityId !== d.attachmentEntityId)
    remaining.push("distinct-auxiliary-provider");
  for (const [kind, value] of [
    ["source", source],
    ["target", target],
  ])
    if (
      ![
        "native-null",
        "viewer-root-input",
        "installed-key-mapped-pose-unresolved",
      ].includes(value.status)
    )
      remaining.push(`${kind}:${value.status}`);
  const components = definition.emitters.map((e) => ({
    index: e.index,
    primitive: e.primitive,
    requirements: e.placementRequirements,
  }));
  const sizeIndependent = components.filter(
    (e) => e.requirements.boundObjectSize === null,
  );
  const quadComponents = sizeIndependent.filter((e) =>
    ["camera-quad", "arbitrary-quad"].includes(e.primitive),
  );
  if (!sizeIndependent.length)
    remaining.push("component:no-bound-size-independent-program");
  rows.push({
    sourceEventId: coverage.id,
    definitionId: coverage.definitionId,
    time: d.time,
    flags: d.flags,
    source,
    target,
    components,
    quadComponentIds: quadComponents.map((e) => e.index),
    remainingDependencies: remaining,
    currentWorldReasons: coverage.reasons.filter((r) => r.startsWith("world:")),
    prospectiveOnly: true,
  });
}
const rank = (selected) => {
  const counts = new Map();
  for (const row of selected) {
    const item = counts.get(row.definitionId) ?? {
      definitionId: row.definitionId,
      requests: 0,
      quadComponentIds: row.quadComponentIds,
      sourceKeys: [],
      targetKeys: [],
    };
    item.requests++;
    for (const [key, value] of [
      ["sourceKeys", row.source],
      ["targetKeys", row.target],
    ])
      if (
        value.entityId &&
        !item[key].some(
          (v) => v.entityId === value.entityId && v.key === value.key,
        )
      )
        item[key].push(value);
    counts.set(row.definitionId, item);
  }
  return [...counts.values()].sort(
    (a, b) =>
      b.requests - a.requests || a.definitionId.localeCompare(b.definitionId),
  );
};
const visualCandidates = rows.filter((row) => row.components.length),
  mapped = visualCandidates.filter((row) => !row.remainingDependencies.length),
  quad = mapped.filter((row) => row.quadComponentIds.length);
for (const [path, digest] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== digest)
    throw Error(`Final input drift: ${path}`);
const output = resolve(cache, "research/viewer-pose-frontier-ranking.json");
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "actual-viewer-pose-frontier-inventory",
      comparisonWindow: [69, 99],
      resourceSelectedWorldBlocked: rows.length,
      withCurrentAdmittedComponents: visualCandidates.length,
      withInstalledPoseKeyInputsAndOtherwiseBoundedDependencies: mapped.length,
      quadOnlyCandidateRequests: quad.length,
      quadOnlyCandidateDefinitions: rank(quad),
      allAdmittedComponentDefinitions: rank(visualCandidates),
      rows,
      inputs,
      scope: {
        inventoryOnly: true,
        eligibilityChanged: false,
        viewerPoseProviderImplemented: false,
        nativePoseParityEstablished: false,
        nativeAcceptance: null,
        actualNewRuntimeActivationEstablished: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    resourceSelectedWorldBlocked: rows.length,
    withCurrentAdmittedComponents: visualCandidates.length,
    mappedCandidates: mapped.length,
    quadOnlyCandidateRequests: quad.length,
    quadDefinitions: rank(quad).map((row) => ({
      definitionId: row.definitionId,
      requests: row.requests,
      emitters: row.quadComponentIds,
    })),
    inputs: Object.keys(inputs).length,
  }),
);
