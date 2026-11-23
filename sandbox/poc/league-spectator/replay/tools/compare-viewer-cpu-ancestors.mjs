import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

// All paths are explicit read-only inputs. No cache discovery or copied fixture.
const [native, sceneRoot, derived, threeModule, output] = process.argv.slice(2);
if (!native || !sceneRoot || !derived || !threeModule || !output)
  throw Error(
    "Usage: compare-viewer-cpu-ancestors.mjs <native-root> <scene-root> <derived-root> <three-module> <output.json>",
  );
const hash = (bytes) =>
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  threeUrl = pathToFileURL(resolve(threeModule)),
  implementationRoots = [new URL(import.meta.url), threeUrl],
  scanner = new Bun.Transpiler({ loader: "js", target: "bun" });
async function captureSourceGraph() {
  const found = new Map();
  async function read(url) {
    if (found.has(url.href)) return;
    const bytes = await Bun.file(url).bytes();
    found.set(url.href, hash(bytes));
    if (/\.(?:mjs|cjs|js|ts)$/.test(url.pathname))
      for (const item of scanner.scanImports(new TextDecoder().decode(bytes)))
        if (item.path.startsWith("./") || item.path.startsWith("../"))
          await read(new URL(item.path, url));
  }
  for (const root of implementationRoots) await read(root);
  return Object.fromEntries([...found].sort(([a], [b]) => a.localeCompare(b)));
}
// Capture before importing any consumer or Three module, then recheck the
// complete literal-import closure at completion. Changed source invalidates
// the receipt instead of labelling end-of-run bytes as the loaded code.
const implementationBefore = await captureSourceGraph(),
  coreUrl = new URL("./three.core.js", threeUrl);
if (
  implementationBefore[coreUrl.href] !==
  "3718df126d69c125362a03340913204470d8c50238605150e57f808840fb7759"
)
  throw Error("Explicit Three module does not import the pinned viewer math");
await Bun.write(
  resolve(output) + ".source-start.json",
  JSON.stringify(implementationBefore, null, 2),
);
const [
  { createSceneAnimationBindings },
  { createAnimationGraph, readAnimationAsset },
  { prepareLatestViewerOrdinalJoints },
  { createLatestViewerPoseHierarchy },
  { applyLatestViewerPoseLayer, viewerPoseJointDefaults },
  { createLatestViewerCpuAncestorPose },
] = await Promise.all([
  import("../scene-animation-bindings.mjs"),
  import("../latest-animation.mjs"),
  import("../latest-viewer-ordinal-joints.mjs"),
  import("../latest-viewer-pose-assets.mjs"),
  import("../latest-viewer-pose-sampler.mjs"),
  import("../latest-viewer-cpu-ancestor-pose.mjs"),
]);
const roots = {
    native: resolve(native),
    scene: resolve(sceneRoot),
    derived: resolve(derived),
  },
  THREE = await import(threeUrl.href),
  sources = new Map(),
  decode = (bytes) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
async function raw(authority, file) {
  const bytes = await Bun.file(join(roots[authority], file)).bytes();
  sources.set(`${authority}:${file}`, hash(bytes));
  return bytes;
}
const sceneBytes = await raw("scene", "manifest.json"),
  scene = decode(sceneBytes),
  world = decode(await raw("scene", scene.world)),
  assets = new Map([
    ...Object.entries(scene.champions).map(([key, value]) => [
      `champions/${key}`,
      value,
    ]),
    ...Object.entries(world.assets).map(([key, value]) => [
      `world/${key}`,
      value,
    ]),
  ]),
  bindings = await createSceneAnimationBindings({
    baseProfileBytes: await raw("native", "profile.json"),
    imageBytes: await raw("native", "image.bin"),
    sceneBytes,
    authorityBytes: await raw("derived", "manifest.json"),
    readResource: ({ authority, file }) => raw(authority, file),
  }),
  temporaries = {
    quaternionA: new THREE.Quaternion(),
    quaternionB: new THREE.Quaternion(),
    vectorA: new THREE.Vector3(),
    vectorB: new THREE.Vector3(),
  },
  digest = new Bun.CryptoHasher("sha256"),
  models = [],
  begin = performance.now();
let matrices = 0,
  scalars = 0,
  resolvedPlans = 0,
  matrixTimeFullMs = 0,
  matrixTimeSparseMs = 0;
function sameMatrix(expected, actual, context) {
  for (let index = 0; index < 16; index++) {
    if (!Object.is(expected[index], actual[index]))
      throw Error(
        `CPU ancestor matrix differs: ${JSON.stringify({ ...context, index, expected: expected[index], actual: actual[index] })}`,
      );
    scalars++;
  }
  digest.update(JSON.stringify(actual) + "\n");
  matrices++;
}
for (const identity of bindings.authority.roles.clock.identities) {
  const asset = assets.get(identity.actor);
  if (!asset?.rigJointBindings)
    throw Error(`Missing ordinal asset ${identity.actor}`);
  const bound = await bindings.bind({ graphFile: identity.graph }),
    graphBytes = await raw("scene", identity.graph),
    graph = createAnimationGraph(
      decode(graphBytes),
      bound.catalog,
      bound.clock,
    ),
    modelBytes = await raw("scene", asset.model),
    modelSha256 = hash(modelBytes),
    handle = await prepareLatestViewerOrdinalJoints({
      modelBytes,
      rigBytes: await raw("scene", identity.rig),
      bindingBytes: await raw("scene", asset.rigJointBindings),
      catalog: bound.catalog,
      rigBindings: bound.rigBindings,
    }),
    makeEntry = () => ({
      ...createLatestViewerPoseHierarchy(
        THREE,
        modelBytes,
        asset,
        bound.catalog,
        { handle, modelSha256 },
      ),
      catalog: bound.catalog,
      poseAssets: new Map(),
    }),
    full = makeEntry(),
    sparse = makeEntry(),
    names = [...full.jointMap.keys()],
    owners = names.map((name) => ({
      name,
      owner: createLatestViewerCpuAncestorPose({
        THREE,
        entry: sparse,
        attachmentNames: [name],
      }),
    })),
    union = createLatestViewerCpuAncestorPose({
      THREE,
      entry: sparse,
      attachmentNames: names,
    }),
    row = {
      actor: identity.actor,
      modelSha256,
      joints: bound.catalog.joints.length,
      attachments: names.length,
      clips: 0,
      plans: 0,
      emptyPlans: 0,
      zeroDurationClips: [],
      unresolved: [],
      selectedJoints: owners.reduce(
        (sum, value) => sum + value.owner.counts.selectedPoseJoints,
        0,
      ),
      baselineJoints: names.length * bound.catalog.joints.length,
    };
  for (const entry of [full, sparse]) {
    entry.mirror.position.set(19, -7, 31);
    entry.mirror.rotation.set(0.1, -0.2, 0.3);
    entry.mirror.scale.set(1.2, 0.7, -1.3);
  }
  for (const file of new Set(
    Object.values(bound.catalog.clips).map((clip) => clip.file),
  )) {
    const bytes = await bound.readLeaf(file),
      pose = readAnimationAsset(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
      );
    full.poseAssets.set(file, pose);
    sparse.poseAssets.set(file, pose);
    row.clips++;
  }
  // Evaluate original atomic names through their actual bound clock/masks.
  // Unsupported graph states stay explicit and never gain an optimized result.
  for (const [name, clip] of Object.entries(bound.catalog.clips)) {
    const nativeDuration = bound.clock.evaluate(name, 0).duration;
    if (!Number.isFinite(nativeDuration) || nativeDuration < 0)
      throw Error("Invalid bound original atomic duration");
    if (nativeDuration === 0)
      row.zeroDurationClips.push({ name, exportedDuration: clip.duration });
    for (const [caseIndex, fraction] of [0, 0.37, 0.93, 0.11].entries()) {
      const elapsed = nativeDuration * fraction,
        plan = graph.evaluate(name, elapsed, { moving: caseIndex % 2 === 1 });
      if (plan.unresolved.length) {
        row.unresolved.push({ name, fraction, reasons: plan.unresolved });
        continue;
      }
      if (!plan.leaves.length) row.emptyPlans++;
      const layers = plan.leaves;
      // A second actual atomic leaf exercises ordered partial layer blending.
      // These explicit weights are controlled interpolation inputs, not a claim
      // that the original controller scheduled this layer combination.
      if (caseIndex === 2 && plan.leaves.length)
        layers.push({ ...plan.leaves[0], weight: 0.25 });
      for (const entry of [full, sparse]) {
        entry.group.position.set(caseIndex * 100, -caseIndex, 203);
        entry.group.rotation.set(0, Math.atan2(caseIndex - 2, 3), 0);
      }
      for (const joint of viewerPoseJointDefaults(full)) {
        joint.node.position.copy(joint.position);
        joint.node.quaternion.copy(joint.quaternion);
        joint.node.scale.copy(joint.scale);
      }
      for (const layer of layers)
        applyLatestViewerPoseLayer(full, layer, temporaries);
      full.group.updateWorldMatrix(true, true);
      for (const { name: attachment, owner } of owners) {
        owner.apply(layers);
        owner.updateWorldMatrices();
        sameMatrix(
          full.jointMap.get(attachment).node.matrixWorld.elements,
          sparse.jointMap.get(attachment).node.matrixWorld.elements,
          { actor: identity.actor, name, fraction, attachment },
        );
      }
      union.apply(layers);
      union.updateWorldMatrices();
      for (const attachment of names)
        sameMatrix(
          full.jointMap.get(attachment).node.matrixWorld.elements,
          sparse.jointMap.get(attachment).node.matrixWorld.elements,
          { actor: identity.actor, name, fraction, attachment, union: true },
        );
      resolvedPlans++;
      row.plans++;
    }
  }
  // A narrowly controlled per-bone query benchmark. It excludes asset loading
  // and graph evaluation and is never reported as a browser seek improvement.
  const file = full.poseAssets.keys().next().value,
    layers = [{ file, phase: 0.31, weight: 1, weights: null }];
  let started = performance.now();
  for (let repeat = 0; repeat < 3; repeat++)
    for (const name of names) {
      for (const joint of viewerPoseJointDefaults(full)) {
        joint.node.position.copy(joint.position);
        joint.node.quaternion.copy(joint.quaternion);
        joint.node.scale.copy(joint.scale);
      }
      for (const layer of layers)
        applyLatestViewerPoseLayer(full, layer, temporaries);
      full.group.updateWorldMatrix(true, true);
      full.jointMap.get(name).node.matrixWorld.toArray();
    }
  matrixTimeFullMs += performance.now() - started;
  started = performance.now();
  for (let repeat = 0; repeat < 3; repeat++)
    for (const { name, owner } of owners) {
      owner.apply(layers);
      owner.updateWorldMatrices();
      sparse.jointMap.get(name).node.matrixWorld.toArray();
    }
  matrixTimeSparseMs += performance.now() - started;
  for (const { owner } of owners) owner.close();
  union.close();
  models.push(row);
  console.log(
    JSON.stringify({
      actor: row.actor,
      clips: row.clips,
      plans: row.plans,
      attachments: row.attachments,
      matrices,
    }),
  );
}
const implementationAfter = await captureSourceGraph(),
  sourceDrift = [
    ...new Set([
      ...Object.keys(implementationBefore),
      ...Object.keys(implementationAfter),
    ]),
  ].filter((file) => implementationBefore[file] !== implementationAfter[file]);
if (sourceDrift.length) {
  await Bun.write(
    resolve(output) + ".source-drift.json",
    JSON.stringify(
      { sourceDrift, implementationBefore, implementationAfter },
      null,
      2,
    ),
  );
  throw Error(
    `Comparison implementation changed during execution: ${sourceDrift.join(", ")}`,
  );
}
const result = {
  scope:
    "Exact current viewer matrix equivalence for all installed-name winners on all explicitly supplied scene models/atomic clocks, plus controlled ordered blending; no native controller or browser performance claim",
  matrices,
  scalars,
  resolvedPlans,
  mismatches: 0,
  outputSha256: digest.digest("hex"),
  elapsedMs: performance.now() - begin,
  isolatedBunPerBoneMathMs: {
    full: matrixTimeFullMs,
    ancestors: matrixTimeSparseMs,
  },
  models,
  implementationSha256: implementationBefore,
  sourceDrift,
  sources: Object.fromEntries(sources),
};
await Bun.write(resolve(output), JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output: resolve(output),
    matrices,
    scalars,
    resolvedPlans,
    mismatches: 0,
    models: models.length,
    isolatedBunPerBoneMathMs: result.isolatedBunPerBoneMathMs,
  }),
);
