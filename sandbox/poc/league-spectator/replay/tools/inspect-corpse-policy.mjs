import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  CORPSE_POLICY_SHA,
  createLatestCorpsePolicy,
  createLatestMinionCorpsePlayback,
} from "../latest-corpse.mjs";
import { bindLatestMinions } from "../latest-world.mjs";
import {
  prepareLatestLifecycle,
  sampleLatestLifecycle,
  sampleLatestDeathPosePreview,
} from "../latest-lifecycle.mjs";
import { createLatestReplayState } from "../latest-replay-state.mjs";
import { unitPlateDrawing } from "../latest-overhead.mjs";
import { pickVisibleReplayEntity } from "../latest-inspection.mjs";
import { loadAnimationPoses } from "./load-animation-poses.mjs";
const [arg] = process.argv.slice(2);
if (!arg) throw Error("Usage: inspect-corpse-policy.mjs <cache>");
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
  bits = (value) => {
    const b = new DataView(new ArrayBuffer(4));
    b.setFloat32(0, value, true);
    return b.getUint32(0, true);
  },
  nativePath = `${cache}/research/corpse-policy-native.json`,
  native = await json(nativePath),
  report = await json(`${cache}/research/latest-semantics-corpse-policy.json`),
  baseline = await json(`${cache}/research/latest-semantics-inventory.json`),
  before = JSON.stringify(report),
  profile = await json(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`),
  sceneBytes = await raw(`${cache}/public/latest-scene/manifest.json`),
  worldBytes = await raw(`${cache}/public/latest-scene/world.json`),
  packageBytes = await raw(`${cache}/public/latest-corpse/package.json`),
  scene = JSON.parse(new TextDecoder().decode(sceneBytes)),
  world = JSON.parse(new TextDecoder().decode(worldBytes)),
  policy = await createLatestCorpsePolicy(
    profile,
    sceneBytes,
    worldBytes,
    packageBytes,
  ),
  bindings = bindLatestMinions(report, scene, world),
  playback = createLatestMinionCorpsePlayback(report, policy, bindings),
  lifecycle = prepareLatestLifecycle(report),
  state = createLatestReplayState(report, {
    entities: report.worldEntities,
    updates: report.worldStateUpdates,
  });
check(
  native.packageSha256 === CORPSE_POLICY_SHA &&
    native.preparerSha256 ===
      sha(await raw(`${root}/tools/prepare-corpse-policy.py`)),
  "Stale native corpse evidence",
);
for (const [p, h] of Object.entries(native.inputs))
  check(sha(await raw(p)) === h, "Native corpse input changed");
for (const [name, h] of Object.entries(native.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === h,
    "Native corpse helper changed",
  );
for (const b of native.originalBlocks)
  check(
    sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Native corpse instruction changed",
  );
for (const b of policy.metadata.sourceBlocks)
  check(
    sha(image.subarray(b.startRva, b.endRva)) === b.sha256,
    "Corpse policy code changed",
  );
let durationChecks = 0,
  deathModeChecks = 0,
  deathPacketChecks = 0,
  legacyChecks = 0,
  clockChecks = 0,
  assetRecordChecks = 0,
  boundaryChecks = 0,
  snapshotChecks = 0,
  preSpawnChecks = 0,
  deathChecks = 0,
  poseChecks = 0;
const structural = await json(`${cache}/research/lifecycle-comparison.json`);
check(
  structural.matched === 142 &&
    structural.unresolved === 0 &&
    structural.mismatches === 0 &&
    structural.results.length === 142 &&
    structural.results.every((r) => r.status === "matched"),
  "Native/WASM lifecycle packet comparison incomplete",
);
for (const c of native.retirementQueueCases) {
  check(
    c.inactiveWord === 0xab71e2a6 &&
      c.before.length === c.index &&
      c.after.length === c.index + 1 &&
      c.before.every((v, i) => c.after[i] === v),
    "Native retirement queue storage differs",
  );
}
for (const p of native.durationProbes) {
  check(
    bits(policy.duration(p.deathTime)) === p.durationBits,
    "Native corpse lifetime getter differs",
  );
  durationChecks++;
}
for (const p of native.deathModeProbes) {
  check(
    policy.modeFromRaw(p.raw) === p.setsDeadFlag,
    "Native death-mode branch differs",
  );
  deathModeChecks++;
}
const nativePackets = await json(`${cache}/research/lifecycle-native.json`),
  reportModes = new Map(
    report.corpseDeathStates.map((e) => [`${e.chunkId}:${e.blockOffset}`, e]),
  );
check(
  reportModes.size === native.deathModes.length,
  "Unit death-mode packet coverage differs",
);
for (const p of native.deathModes) {
  const o = nativePackets.observations[p.packetKey],
    actual = policy.readUnitDeath({
      complete: o.status === "complete",
      object: new Uint8Array(Buffer.from(o.object, "hex")),
    }),
    event = reportModes.get(`${p.chunkId}:${p.blockOffset}`);
  same(
    actual,
    { entityId: p.entityId, rawModeByte: p.raw, setsDeadFlag: p.setsDeadFlag },
    "Native unit death-mode projection differs",
  );
  check(
    event &&
      event.entityId === actual.entityId &&
      event.time === p.time &&
      event.rawModeByte === p.raw &&
      event.setsDeadFlag === p.setsDeadFlag,
    "Worker unit death-mode event differs",
  );
  deathPacketChecks++;
}
for (const [key, value] of Object.entries(baseline)) {
  same(
    report[key],
    key === "summary"
      ? { ...value, unitDeathModeRecords: native.deathModes.length }
      : value,
    `Prior reconstruction changed: ${key}`,
  );
  legacyChecks++;
}
for (const p of native.clockProbes) {
  const a = policy.retainsTicks(p.dead, p.ticks, p.deathTime);
  check(
    a.retained === p.retained &&
      bits(a.age) === p.ageBits &&
      bits(a.duration) === p.durationBits,
    "Native retention/stopwatch result differs",
  );
  clockChecks++;
}
for (const a of Object.values(policy.metadata.assets)) {
  const catalog = await json(`${cache}/public/latest-scene/${a.catalog}`);
  check(
    inputs[`${cache}/public/latest-scene/${a.catalog}`] === a.catalogSha256,
    "Corpse character catalog changed",
  );
  for (const [name, row] of Object.entries(a.records)) {
    const source = catalog.records[name].data,
      value = source.deathTime ?? policy.metadata.characterDeathTimeDefault;
    check(
      bits(policy.duration(value)) === row.durationBits,
      "Authored corpse duration binding differs",
    );
    assetRecordChecks++;
  }
}
for (const n of native.observations) {
  const track = lifecycle.tracks.get(n.entityId),
    event = track.find((i) => i.death.sequence === n.sequence)?.death,
    sample = playback.sample(n.entityId, n.time);
  check(
    event &&
      event.time === n.deathTime &&
      sample.visible === n.retained &&
      bits(sample.age) === n.ageBits &&
      sample.duration === n.duration,
    "Recorded minion corpse boundary differs",
  );
  boundaryChecks++;
}
const times = [
    ...new Set([
      0,
      120,
      ...Array.from({ length: 481 }, (_, i) => i / 4),
      ...native.observations.map((n) => n.time),
      ...bindings.minions.flatMap((b) => [
        Math.max(0, b.event.time - 0.001),
        b.event.time,
      ]),
    ]),
  ].sort((a, b) => a - b),
  saved = new Map();
for (const b of bindings.minions) {
  const id = b.event.entityId;
  for (const t of times) {
    const sample = playback.sample(id, t),
      s = state.sampleEntity(id, t),
      life = sampleLatestLifecycle(lifecycle.tracks.get(id), t);
    check(
      (sample.status === "Not spawned") === !s.present,
      "Corpse visibility leaked before creation",
    );
    if (!s.present || life.dead)
      check(
        !unitPlateDrawing(s).visible,
        "Dead/unspawned minion overhead reappeared",
      );
    if (sample.status === "Retired corpse")
      check(
        s.present && s.dead && !sample.visible,
        "Render retirement destroyed the unit's historical state",
      );
    if (sample.status === "Alive")
      check(
        sample.visible && !life.dead,
        "Living unit was retired by a corpse timer",
      );
    saved.set(`${id}:${t}`, JSON.stringify(sample));
    snapshotChecks++;
  }
  for (const t of [...times].reverse())
    check(
      JSON.stringify(playback.sample(id, t)) === saved.get(`${id}:${t}`),
      "Corpse visibility reverse seek differs",
    );
  check(
    !playback.sample(id, b.event.time - 0.001).visible,
    "Future minion visible",
  );
  preSpawnChecks++;
  for (const interval of lifecycle.tracks.get(id) ?? []) {
    check(
      playback.sample(id, interval.death.time).status === "Corpse",
      "Corpse missing at recorded death",
    );
    deathChecks++;
  }
}
await raw(`${cache}/public/decoder-16.21-macos/animation-clock.json`);
await raw(`${cache}/public/latest-animation-poses/manifest.json`);
const poseFactory = await loadAnimationPoses(`${cache}/public/latest-scene`);
for (const assetKey of new Set(bindings.minions.map((b) => b.unit.asset))) {
  const asset = world.assets[assetKey],
    binding = await poseFactory.bind(asset);
  await raw(`${cache}/public/latest-scene/${asset.animationGraph}`);
  await raw(`${cache}/public/latest-scene/${asset.animationCatalog}`);
  for (const file of binding.graph.dependencies("Death"))
    await raw(
      `${cache}/public/latest-animation-poses/${binding.directory}/${file}`,
    );
  const life = {
    dead: true,
    interval: { death: { time: 10 }, postDeathActions: [] },
  };
  for (const elapsed of [0, 0.1, 0.5, 1, 4]) {
    const result = sampleLatestDeathPosePreview(
        binding.graph,
        life,
        10 + elapsed,
      ),
      start = binding.graph.evaluate("Death", 0, { moving: false }),
      expected = binding.graph.evaluate(
        "Death",
        Math.min(elapsed, Math.max(0, start.duration - 0.000001)),
        { moving: false },
      );
    same(result, expected, "Shared corpse pose changed its preview convention");
    poseChecks++;
  }
}
const first = bindings.minions.find((b) =>
    lifecycle.tracks.has(b.event.entityId),
  ),
  id = first.event.entityId,
  death = lifecycle.tracks.get(id)[0].death,
  cases = [0.25, 2, 4, 4.25, 5].map((delta) => ({
    label: `Death + ${delta}s`,
    entityId: id,
    time: death.time + delta,
    deathTime: death.time,
    asset: first.unit.asset,
    retention: playback.sample(id, death.time + delta),
    state: state.sampleEntity(id, death.time + delta),
  }));
const THREE = await import(
    pathToFileURL(`${cache}/public/vendor/three.module.js`).href
  ),
  camera = new THREE.PerspectiveCamera(45, 1, 1, 2000),
  ray = new THREE.Raycaster(),
  group = new THREE.Group(),
  mesh = new THREE.Mesh(
    new THREE.BoxGeometry(100, 100, 100),
    new THREE.MeshBasicMaterial(),
  );
group.userData.replayEntityId = id;
group.add(mesh);
camera.position.set(0, 0, 500);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();
let pickingChecks = 0;
for (const t of [death.time + 1, death.time + 5, death.time + 1]) {
  group.visible = playback.sample(id, t).visible;
  group.updateMatrixWorld(true);
  ray.setFromCamera(new THREE.Vector2(0, 0), camera);
  check(
    pickVisibleReplayEntity(ray.intersectObject(group, true), new Set([id])) ===
      (group.visible ? id : null),
    "Retired corpse picking differs",
  );
  pickingChecks++;
}
mesh.geometry.dispose();
mesh.material.dispose();
let rejectionChecks = 0;
for (const fn of [
  () => policy.modeFromRaw(256),
  () =>
    createLatestMinionCorpsePlayback(
      { ...report, corpseDeathStates: [] },
      policy,
      bindings,
    ),
  () =>
    createLatestMinionCorpsePlayback(
      {
        ...report,
        corpseDeathStates: report.corpseDeathStates.map((e) =>
          e.sequence === death.sequence
            ? {
                ...e,
                rawModeByte:
                  policy.metadata.unitDeathMode.setsDeadFlag.findIndex(
                    (v) => !v,
                  ),
                setsDeadFlag: false,
              }
            : e,
        ),
      },
      policy,
      bindings,
    ),
  () => policy.duration(NaN),
  () => policy.duration(1e40),
  () => policy.retainsTicks(1, 0, 4),
  () => policy.retainsTicks(true, -1, 4),
  () => policy.bind("bad", []),
  () => policy.bind(first.unit.asset, ["bad"]),
  () => playback.sample(report.heroes[0].entityId, 0),
  () => playback.sample(id, 121),
  () =>
    createLatestCorpsePolicy(
      { ...profile, protocolDigest: "bad" },
      sceneBytes,
      worldBytes,
      packageBytes,
    ),
  () =>
    createLatestCorpsePolicy(
      profile,
      new Uint8Array(),
      worldBytes,
      packageBytes,
    ),
  () =>
    createLatestCorpsePolicy(profile, sceneBytes, worldBytes, new Uint8Array()),
]) {
  let failed = false;
  try {
    await fn();
  } catch {
    failed = true;
  }
  check(failed, "Unadmitted corpse input accepted");
  rejectionChecks++;
}
check(
  JSON.stringify(report) === before,
  "Corpse presentation mutated reconstructed match state",
);
const sources = {};
for (const name of [
  "latest-corpse.mjs",
  "latest-lifecycle.mjs",
  "latest-world.mjs",
  "latest-replay-state.mjs",
  "latest-overhead.mjs",
  "latest-inspection.mjs",
  "latest-viewer.mjs",
  "latest.html",
  "latest-animation.mjs",
  "latest-animation-poses.mjs",
  "tools/load-animation-poses.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const counts = {
  structuralPackets: structural.matched,
  retirementQueueCases: native.retirementQueueCases.length,
  assets: native.counts.assets,
  assetRecordChecks,
  durationChecks,
  deathModeChecks,
  deathPacketChecks,
  legacyChecks,
  clockChecks,
  boundaryChecks,
  minions: bindings.minions.length,
  snapshotChecks,
  reverseSeekChecks: snapshotChecks,
  preSpawnChecks,
  deathChecks,
  poseChecks,
  pickingChecks,
  rejectionChecks,
};
await Bun.write(
  `${cache}/research/corpse-policy-comparison.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "minion-corpse-retention-comparison",
      packageSha256: CORPSE_POLICY_SHA,
      nativeEvidenceSha256: inputs[nativePath],
      inspectorSha256: sha(await raw(import.meta.path)),
      inputs,
      sources,
      counts,
      cases,
      scope: {
        ...native.scope,
        mainViewerSourceIntegrated: true,
        threeRaycastExecuted: true,
        sharedDeathPosePreviewUsed: true,
        browserRun: false,
        leagueAvCompared: false,
        wholeMatchVerified: false,
      },
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(counts));
