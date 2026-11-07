import { resolve } from "node:path";
import {
  createLatestWorldStateReader,
  WORLD_STATE_SHA,
} from "../latest-world-state.mjs";
import { createLatestReplayState } from "../latest-replay-state.mjs";
import {
  prepareLatestLifecycle,
  sampleLatestLifecycle,
} from "../latest-lifecycle.mjs";
import { unitPlateDrawing, championPlateSvg } from "../latest-overhead.mjs";
const [arg] = process.argv.slice(2);
if (!arg) throw Error("Usage: inspect-world-state.mjs <cache>");
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
  sorted = (o) =>
    JSON.stringify(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
const nativePath = `${cache}/research/world-state-native.json`,
  native = await json(nativePath),
  report = await json(`${cache}/research/latest-semantics-world-state.json`),
  baseline = await json(
    `${cache}/research/latest-semantics-champion-state.json`,
  ),
  replication = await json(`${cache}/research/latest-replication-native.json`),
  profile = await json(`${cache}/public/decoder-16.21-macos/profile.json`),
  image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`),
  packageBytes = await raw(`${cache}/public/latest-world-state/package.json`),
  reader = await createLatestWorldStateReader(
    profile,
    image,
    packageBytes,
    await raw(`${cache}/public/latest-scene/manifest.json`),
    await raw(`${cache}/public/latest-scene/world.json`),
  );
check(
  native.packageSha256 === WORLD_STATE_SHA &&
    report.worldStatePackageSha256 === WORLD_STATE_SHA &&
    native.preparerSha256 ===
      sha(await raw(`${root}/tools/prepare-world-state.py`)),
  "Stale native world schema",
);
for (const [p, h] of Object.entries(native.inputs))
  check(sha(await raw(p)) === h, `Native world input changed: ${p}`);
for (const [name, h] of Object.entries(native.sources))
  check(sha(await raw(`${root}/tools/${name}`)) === h, "Native helper changed");
for (const b of native.originalBlocks)
  check(
    sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Original world block changed",
  );
const world = reader.reconstruct(report),
  ids = new Map(world.entities.map((e) => [e.entityId, e])),
  packets = new Map(replication.records.map((p) => [p.key, p])),
  expectedUpdates = [];
check(
  JSON.stringify(world.entities) === JSON.stringify(report.worldEntities) &&
    JSON.stringify(world.updates) === JSON.stringify(report.worldStateUpdates),
  "Worker world state differs from reader",
);
for (const e of native.entities) {
  const got = ids.get(e.entityId);
  for (const key of [
    "entityClass",
    "creationTime",
    "asset",
    "characterRecords",
    "team",
  ])
    check(
      JSON.stringify(got[key]) === JSON.stringify(e[key]),
      `Native entity binding differs: ${key}`,
    );
  check(got.replicationSchema === e.schema, "Wrong native class variant");
}
let groupChecks = 0,
  byteChecks = 0,
  consumerChecks = 0;
for (const observed of native.records) {
  const record = packets.get(observed.packetKey).records[observed.recordIndex],
    decoded = reader.worldState(
      { ...record, time: observed.time },
      ids.get(record.entityId),
    );
  check(
    JSON.stringify(decoded.groups) === JSON.stringify(observed.groups),
    "Native world group differs",
  );
  check(
    sorted(decoded.consumerBits) === sorted(observed.consumerBits),
    "Native world health getter differs",
  );
  groupChecks += decoded.groups.length;
  byteChecks += decoded.groups.reduce((n, g) => n + g.consumed, 0);
  consumerChecks += Object.keys(decoded.consumerBits).length;
  if (Object.keys(decoded.values).length)
    expectedUpdates.push({
      entityId: record.entityId,
      time: observed.time,
      ...decoded.values,
    });
}
check(
  expectedUpdates.length === world.updates.length,
  "World state update count differs",
);
for (const [i, u] of expectedUpdates.entries()) {
  const got = world.updates[i];
  check(
    Object.entries(u).every(([k, v]) => got[k] === v),
    "Worker health observation differs",
  );
}
let legacyChecks = 0;
for (const [key, value] of Object.entries(baseline)) {
  if (key === "summary") {
    for (const [k, v] of Object.entries(value))
      check(report.summary[k] === v, `Legacy summary changed: ${k}`);
  } else
    check(
      JSON.stringify(report[key]) === JSON.stringify(value),
      `Legacy report changed: ${key}`,
    );
  legacyChecks++;
}
const state = createLatestReplayState(report, world),
  heroState = createLatestReplayState(report),
  lifecycle = prepareLatestLifecycle(report),
  times = [
    ...new Set([
      0,
      report.endTime,
      ...world.updates.map((u) => u.time),
      ...world.entities.flatMap((e) => [
        Math.max(0, e.creationTime - 0.001),
        e.creationTime,
      ]),
      ...report.lifecycle
        .filter((e) => ids.has(e.entityId))
        .flatMap((e) => [Math.max(0, e.time - 0.001), e.time]),
    ]),
  ].sort((a, b) => a - b),
  saved = new Map(),
  cases = [],
  observations = { currentHealth: 0, maxHealth: 0 },
  coverage = {};
for (const u of world.updates)
  for (const k of Object.keys(observations))
    if (Object.hasOwn(u, k)) observations[k]++;
let snapshotChecks = 0,
  creationChecks = 0,
  deathChecks = 0,
  heroRegressionChecks = 0;
for (const e of world.entities) {
  const track = world.updates
    .filter((u) => u.entityId === e.entityId)
    .sort(
      (a, b) =>
        a.time - b.time ||
        a.transportSequence - b.transportSequence ||
        a.recordIndex - b.recordIndex,
    );
  coverage[e.entityId] = {
    entityClass: e.entityClass,
    updates: track.length,
    healthAvailableAtEnd:
      state.sampleEntity(e.entityId, report.endTime).maxHealth !== null,
  };
  for (const t of times) {
    const s = state.sampleEntity(e.entityId, t),
      expected = { currentHealth: null, maxHealth: null };
    for (const u of track) {
      if (u.time > t) break;
      for (const k of Object.keys(expected))
        if (Object.hasOwn(u, k)) expected[k] = u[k];
    }
    for (const k of Object.keys(expected))
      check(s[k] === expected[k], `World sampled ${k} differs`);
    const dead = sampleLatestLifecycle(
      lifecycle.tracks.get(e.entityId),
      t,
    ).dead;
    check(
      s.dead === dead && s.present === t >= e.creationTime,
      "World sampled lifetime differs",
    );
    const drawing = unitPlateDrawing(s);
    check(
      drawing.visible ===
        (s.present &&
          !dead &&
          s.currentHealth !== null &&
          s.currentHealth > 0 &&
          s.maxHealth > 0),
      "World bar visibility differs",
    );
    saved.set(`${e.entityId}:${t}`, JSON.stringify(s));
    snapshotChecks++;
  }
  for (const t of [...times].reverse())
    check(
      JSON.stringify(state.sampleEntity(e.entityId, t)) ===
        saved.get(`${e.entityId}:${t}`),
      "Reverse world seek differs",
    );
  if (e.creationTime > 0) {
    const s = state.sampleEntity(e.entityId, e.creationTime - 0.001);
    check(
      !s.present && s.currentHealth === null && !unitPlateDrawing(s).visible,
      "Future minion leaks before spawn",
    );
    creationChecks++;
  }
  for (const interval of lifecycle.tracks.get(e.entityId) ?? []) {
    const s = state.sampleEntity(e.entityId, interval.death.time);
    check(
      !unitPlateDrawing(s).visible &&
        !championPlateSvg(unitPlateDrawing(s)).includes("<rect"),
      "Dead world entity retains bar",
    );
    deathChecks++;
  }
}
for (const t of [0, 45, 60, 90, 105, 120])
  for (const h of report.heroes) {
    check(
      JSON.stringify(state.sampleEntity(h.entityId, t)) ===
        JSON.stringify(heroState.sampleEntity(h.entityId, t)),
      "World integration changed champion state",
    );
    heroRegressionChecks++;
  }
let rejectionChecks = 0;
const minion = world.entities.find((e) => e.entityClass === "lane-minion"),
  tower = world.entities.find((e) => e.entityClass === "turret");
for (const fn of [
  () =>
    reader.worldState(
      { entityId: minion.entityId, time: 0, groups: [] },
      minion,
    ),
  () => reader.worldState({ entityId: 0, time: 120, groups: [] }, minion),
  () =>
    reader.worldState(
      {
        entityId: minion.entityId,
        time: 120,
        groups: [{ group: 8, mask: 1, dataHex: "fe00" }],
      },
      minion,
    ),
  () =>
    reader.worldState(
      {
        entityId: tower.entityId,
        time: 120,
        groups: [{ group: 8, mask: 1, dataHex: "ff" }],
      },
      tower,
    ),
  () =>
    createLatestReplayState(report, {
      entities: [world.entities[0], world.entities[0]],
      updates: [],
    }),
  () => state.sampleEntity(minion.entityId, report.endTime + 1),
]) {
  let rejected = false;
  try {
    fn();
  } catch {
    rejected = true;
  }
  check(rejected, "Invalid world state accepted");
  rejectionChecks++;
}
const damagedMinion = world.entities.find(
    (e) =>
      e.entityClass === "lane-minion" &&
      world.updates.some(
        (u) =>
          u.entityId === e.entityId &&
          u.currentHealth > 0 &&
          u.currentHealth < state.sampleEntity(e.entityId, u.time).maxHealth,
      ),
  ),
  damagedUpdate = world.updates.find(
    (u) =>
      u.entityId === damagedMinion?.entityId &&
      u.currentHealth > 0 &&
      u.currentHealth < state.sampleEntity(u.entityId, u.time).maxHealth,
  ),
  minionDeath = lifecycle.tracks.get(damagedMinion.entityId)?.[0];
for (const [label, e, t] of [
  ["Tower at match start", tower, 0],
  ["Before minion spawn", damagedMinion, damagedMinion.creationTime - 0.001],
  ["At minion spawn", damagedMinion, damagedMinion.creationTime],
  ["Recorded damage", damagedMinion, damagedUpdate.time],
  ["Recorded death", damagedMinion, minionDeath.death.time],
  ["Seek back to damage", damagedMinion, damagedUpdate.time],
]) {
  const s = state.sampleEntity(e.entityId, t);
  cases.push({
    label,
    entity: e,
    time: t,
    state: s,
    drawing: unitPlateDrawing(s),
  });
}
check(
  groupChecks === native.counts.nativeGroups &&
    byteChecks === native.counts.nativeBytes &&
    consumerChecks === native.counts.consumerChecks,
  "Native world corpus incomplete",
);
const sources = {};
for (const name of [
  "latest-world-state.mjs",
  "latest-world.mjs",
  "latest-state-fields.mjs",
  "latest-champion-state.mjs",
  "latest-replay-state.mjs",
  "latest-overhead.mjs",
  "latest-reconstruction.mjs",
  "latest-viewer.mjs",
  "structural-check-worker.mjs",
  "latest-lifecycle.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const counts = {
  entities: world.entities.length,
  minions: world.entities.filter((e) => e.entityClass === "lane-minion").length,
  towers: world.entities.filter((e) => e.entityClass === "turret").length,
  groupChecks,
  byteChecks,
  consumerChecks,
  updates: world.updates.length,
  snapshotChecks,
  reverseSeekChecks: snapshotChecks,
  creationChecks,
  deathChecks,
  heroRegressionChecks,
  legacyChecks,
  rejectionChecks,
  observations,
  entitiesWithHealth: Object.values(coverage).filter(
    (c) => c.healthAvailableAtEnd,
  ).length,
};
await Bun.write(
  `${cache}/research/world-state-comparison.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "world-state-native-js-comparison",
      packageSha256: sha(packageBytes),
      nativeEvidenceSha256: inputs[nativePath],
      inspectorSha256: sha(await raw(import.meta.path)),
      inputs,
      sources,
      counts,
      cases,
      coverage,
      scope: {
        nativeSchemaExecuted: true,
        fullWorldGroupsParsed: true,
        mainViewerSourceIntegrated: true,
        browserRun: false,
        leagueAvCompared: false,
        layoutReferenceVerified: false,
        minionTeamSemanticsVerified: false,
        arbitrarySrMatchesVerified: false,
      },
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(counts));
