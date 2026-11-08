import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  createSubmeshVisibilityScheduler,
  createLatestSubmeshVisibility,
  bindSubmeshVisibilityNodes,
  SUBMESH_VISIBILITY_SHA,
} from "../latest-submesh-visibility.mjs";
import {
  prepareLatestLifecycle,
  sampleLatestLifecycle,
  sampleLatestDeathPosePreview,
} from "../latest-lifecycle.mjs";
import { loadAnimationPoses } from "./load-animation-poses.mjs";
const [arg] = process.argv.slice(2);
if (!arg) throw Error("Usage: inspect-submesh-visibility.mjs <cache>");
const cache = resolve(arg),
  root = resolve(import.meta.dir, ".."),
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = new Uint8Array(await Bun.file(p).arrayBuffer());
    inputs[p] = sha(b);
    return b;
  },
  json = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  same = (a, b, m) => check(isDeepStrictEqual(a, b), m),
  nativePath = `${cache}/research/submesh-visibility-native.json`,
  native = await json(nativePath),
  profile = await json(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`),
  sceneBytes = await raw(`${cache}/public/latest-scene/manifest.json`),
  scene = JSON.parse(new TextDecoder().decode(sceneBytes)),
  world = await json(`${cache}/public/latest-scene/${scene.world}`),
  bytes = await raw(`${cache}/public/latest-submesh-visibility/package.json`),
  factory = await createLatestSubmeshVisibility(profile, sceneBytes, bytes),
  meta = factory.metadata,
  report = await json(`${cache}/research/latest-semantics-combat-stats.json`),
  lifecycle = prepareLatestLifecycle(report),
  poseFactory = await loadAnimationPoses(`${cache}/public/latest-scene`),
  THREE = await import(
    pathToFileURL(`${cache}/public/vendor/three.module.js`).href
  );
check(
  native.packageSha256 === SUBMESH_VISIBILITY_SHA &&
    native.preparerSha256 ===
      sha(await raw(`${root}/tools/prepare-submesh-visibility.py`)),
  "Submesh native proof stale",
);
for (const [p, h] of Object.entries(native.inputs))
  check(sha(await raw(p)) === h, "Submesh source asset changed");
for (const [name, h] of Object.entries(native.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === h,
    "Submesh native helper changed",
  );
for (const b of native.originalBlocks)
  check(
    sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Submesh executed original instruction changed",
  );
for (const b of meta.sourceBlocks)
  check(
    sha(image.subarray(b.startRva, b.endRva)) === b.sha256,
    "Submesh source code changed",
  );
let nativeFrames = 0,
  checkpointChecks = 0,
  resetChecks = 0;
for (const [index, s] of native.sequences.entries()) {
  const scheduler = createSubmeshVisibilityScheduler(
      s.names,
      s.events,
      s.initial,
      s.avatar,
    ),
    saved = [];
  for (const frame of s.frames) {
    const handle = scheduler.checkpoint(),
      actual = scheduler.step(frame.frame, frame.resync);
    same(
      actual,
      frame.output,
      `Submesh native frame differs: ${index}:${nativeFrames}`,
    );
    nativeFrames++;
    scheduler.restore(handle);
    same(
      scheduler.step(frame.frame, frame.resync),
      actual,
      "Restored masks/phase differs",
    );
    checkpointChecks++;
    scheduler.releaseCheckpoint(handle);
    saved.push(actual);
  }
  scheduler.reset();
  for (const [i, frame] of s.frames.entries()) {
    same(
      scheduler.step(frame.frame, frame.resync),
      saved[i],
      "Reset continuation differs",
    );
    resetChecks++;
  }
}
const assetEntries = [
    ...Object.values(scene.champions),
    ...Object.values(world.assets).filter((a) => a.animationGraph),
  ],
  bindings = new Map();
const deathGraphGaps = [];
let deathGraphChecks = 0,
  rangeChecks = 0,
  maskChecks = 0,
  nodeChecks = 0;
for (const a of assetEntries) {
  const entry = meta.assets[a.animationGraph],
    binding = await factory.bind(
      a,
      await raw(`${cache}/public/latest-scene/${a.model}`),
      await raw(`${cache}/public/latest-scene/${a.animationGraph}`),
    );
  bindings.set(a.animationGraph, binding);
  const poseBinding = await poseFactory.bind(a),
    deathStart = poseBinding.graph.evaluate("Death", 0, { moving: false });
  if (deathStart.unresolved.length) {
    deathGraphGaps.push({ model: a.model, unresolved: deathStart.unresolved });
  } else {
    for (const t of [0, 0.5, 5]) {
      const result = sampleLatestDeathPosePreview(
        poseBinding.graph,
        { dead: true, interval: { death: { time: 0 }, postDeathActions: [] } },
        t,
      );
      check(
        result.leaves.length === 1,
        "Prepared death graph is not admitted as a single atomic pose",
      );
      deathGraphChecks++;
    }
  }
  rangeChecks += entry.ranges.length;
  const group = new THREE.Group(),
    nodes = entry.ranges.map((r) => {
      const mesh = new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshBasicMaterial(),
      );
      mesh.material.name = r.name;
      group.add(mesh);
      return mesh;
    }),
    controller = bindSubmeshVisibilityNodes(
      group,
      binding,
      a.unsupportedMaterials,
    );
  for (const name of entry.allClips) {
    const c = entry.clips[name];
    if (c?.events.some((e) => e.avatarOnly)) continue;
    for (const t of [0, 1, 28, 70, 1000]) {
      const value = binding.sample(name, t),
        s = createSubmeshVisibilityScheduler(
          entry.ranges.map((r) => r.name),
          c?.events ?? [],
          binding.initialMask,
        ),
        clocks = [
          ...new Set([
            0,
            ...(c?.events ?? [])
              .flatMap((e) => [
                Math.fround(e.startFrame),
                Math.fround(e.endFrame),
              ])
              .filter((f) => f >= 0 && f <= t),
            t,
          ]),
        ].sort((a, b) => a - b);
      let state;
      for (const f of clocks) state = s.step(f);
      check(value.mask === state.masks[0], "Bound clip mask differs");
      maskChecks++;
      controller.apply(value.mask);
      for (const [i, node] of nodes.entries()) {
        const r = entry.ranges[i],
          omitted = Object.keys(a.unsupportedMaterials).some(
            (n) => n.toLowerCase() === r.name.toLowerCase(),
          );
        check(
          node.visible === (!omitted && !!(value.mask & r.mask)),
          "Actual Three node visibility differs",
        );
        nodeChecks++;
      }
    }
  }
  for (const n of nodes) {
    n.geometry.dispose();
    n.material.dispose();
  }
}
let deathChecks = 0,
  reverseSeekChecks = 0,
  respawnChecks = 0,
  postDeathUnresolved = 0;
const cases = [];
for (const h of report.heroes) {
  const asset = scene.champions[`${h.champion.toLowerCase()}/${h.skinId}`],
    pose = await poseFactory.bind(asset),
    binding = bindings.get(asset.animationGraph),
    saved = new Map(),
    times = [];
  for (const interval of lifecycle.tracks.get(h.entityId) ?? []) {
    for (const d of [0, 0.25, 1, 2, 3, 5, 8]) {
      const t = interval.death.time + d;
      if (
        t <= report.endTime &&
        (interval.respawn === null || t < interval.respawn.time)
      )
        times.push(t);
    }
    if (interval.respawn) {
      check(
        !sampleLatestLifecycle(
          lifecycle.tracks.get(h.entityId),
          interval.respawn.time,
        ).dead,
        "Respawn lifecycle still dead",
      );
      respawnChecks++;
    }
  }
  for (const t of times) {
    const life = sampleLatestLifecycle(lifecycle.tracks.get(h.entityId), t),
      p = sampleLatestDeathPosePreview(pose.graph, life, t);
    if (!p) {
      postDeathUnresolved++;
      continue;
    }
    check(p.leaves.length === 1, "Unadmitted compound death pose");
    const layer = p.leaves[0],
      value = binding.sample(layer.name, layer.eventFrame);
    saved.set(t, JSON.stringify(value));
    deathChecks++;
    if (
      h.champion === "Viego" &&
      [0, 1, 3, 5].some(
        (d) => Math.abs(t - life.interval.death.time - d) < 0.00001,
      )
    )
      cases.push({
        label: `Viego · death +${(t - life.interval.death.time).toFixed(0)}s`,
        asset: `${h.champion.toLowerCase()}/${h.skinId}`,
        time: t,
        deathTime: life.interval.death.time,
        frame: layer.eventFrame,
        mask: value.mask,
        initialMask: binding.initialMask,
        visible: binding.ranges
          .filter((r) => value.mask & r.mask)
          .map((r) => r.name),
      });
  }
  for (const t of [...saved.keys()].reverse()) {
    const p = sampleLatestDeathPosePreview(
        pose.graph,
        sampleLatestLifecycle(lifecycle.tracks.get(h.entityId), t),
        t,
      ),
      layer = p.leaves[0];
    check(
      JSON.stringify(binding.sample(layer.name, layer.eventFrame)) ===
        saved.get(t),
      "Death visibility reverse seek differs",
    );
    reverseSeekChecks++;
  }
}
let rejectionChecks = 0;
for (const fn of [
  () =>
    createLatestSubmeshVisibility(
      { ...profile, clientVersion: "other" },
      sceneBytes,
      bytes,
    ),
  () => createLatestSubmeshVisibility(profile, new Uint8Array([0]), bytes),
  () => createLatestSubmeshVisibility(profile, sceneBytes, new Uint8Array([0])),
  () =>
    createSubmeshVisibilityScheduler(
      ["Body"],
      [{ id: "a", startFrame: Infinity }],
    ),
  () =>
    createSubmeshVisibilityScheduler(["Body"], [{ id: "a", unknown: true }]),
  () =>
    createSubmeshVisibilityScheduler(
      ["Body"],
      [{ id: "a", show: ["Body"], showMask: 0 }],
    ),
  () => createSubmeshVisibilityScheduler(["Body"], [{ id: "a" }, { id: "a" }]),
  () => {
    const s = createSubmeshVisibilityScheduler(["Body"], []);
    s.step(1);
    s.step(0);
  },
  () => createSubmeshVisibilityScheduler(["Body"], []).restore({}),
  () => createSubmeshVisibilityScheduler(["Body"], [], NaN),
  () => createSubmeshVisibilityScheduler(["Bödy"], []),
  () => bindings.values().next().value.sample("absent-clip", 0),
  () => bindings.values().next().value.sample("Death", -1),
]) {
  let rejected = false;
  try {
    await fn();
  } catch {
    rejected = true;
  }
  check(rejected, "Invalid submesh input accepted");
  rejectionChecks++;
}
const sources = {};
for (const name of [
  "latest-submesh-visibility.mjs",
  "latest-viewer.mjs",
  "latest-lifecycle.mjs",
  "latest-animation.mjs",
  "latest.html",
  "tools/load-animation-poses.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const counts = {
  ...native.counts,
  nativeFrames,
  checkpointChecks,
  resetChecks,
  rangeChecks,
  maskChecks,
  nodeChecks,
  deathChecks,
  reverseSeekChecks,
  respawnChecks,
  postDeathUnresolved,
  rejectionChecks,
  deathGraphChecks,
  unresolvedDeathGraphs: deathGraphGaps.length,
};
await Bun.write(
  `${cache}/research/submesh-visibility-comparison.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "submesh-visibility-comparison",
      packageSha256: SUBMESH_VISIBILITY_SHA,
      nativeEvidenceSha256: inputs[nativePath],
      inspectorSha256: sha(await raw(import.meta.path)),
      inputs,
      sources,
      counts,
      cases,
      deathGraphGaps,
      scope: {
        ...native.scope,
        translatedSchedulerCompared: true,
        mainDeathPreviewSourceIntegrated: true,
        threeNodeVisibilityExecuted: true,
        boundaryClockSupplied: true,
        initialSkinMaskSupplied: true,
        nativeAnimationClockVerified: false,
        fullGraphLifecycleVerified: false,
        avatarOnlyGraphicsCompositionVerified: false,
        championCorpseRetirementVerified: false,
        browserRun: false,
        leagueAvCompared: false,
      },
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(counts));
