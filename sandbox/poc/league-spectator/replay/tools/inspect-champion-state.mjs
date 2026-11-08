import { resolve } from "node:path";
import {
  createLatestChampionStateReader,
  CHAMPION_STATE_FIELDS,
  primaryResourcePresentation,
} from "../latest-champion-state.mjs";
import { createLatestReplayState } from "../latest-replay-state.mjs";
import {
  prepareLatestLifecycle,
  sampleLatestLifecycle,
} from "../latest-lifecycle.mjs";
import { championPlateDrawing, championPlateSvg } from "../latest-overhead.mjs";
const [arg] = process.argv.slice(2);
if (!arg || process.argv.length !== 3)
  throw Error("Usage: inspect-champion-state.mjs <cache>");
const cache = resolve(arg),
  root = resolve(import.meta.dir, ".."),
  dec = `${cache}/public/decoder-16.21-macos`,
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
const nativePath = `${cache}/research/champion-state-native.json`,
  native = await json(nativePath),
  reportPath = `${cache}/research/latest-semantics-champion-state.json`,
  report = await json(reportPath),
  old = await json(`${cache}/research/latest-semantics-health.json`),
  replication = await json(`${cache}/research/latest-replication-native.json`),
  profile = await json(`${dec}/profile.json`),
  image = await raw(`${dec}/image.bin`),
  packageBytes = await raw(
    `${cache}/public/latest-champion-state/package.json`,
  ),
  replicationBytes = await raw(
    `${cache}/public/latest-replication/package.json`,
  ),
  reader = await createLatestChampionStateReader(
    profile,
    image,
    replicationBytes,
    packageBytes,
  ),
  meta = reader.metadata,
  scene = await json(`${cache}/public/latest-scene/manifest.json`);
check(
  native.packageSha256 === sha(packageBytes) &&
    native.packageSha256 === report.championStatePackageSha256 &&
    native.preparerSha256 ===
      sha(await raw(`${root}/tools/prepare-champion-state.py`)),
  "Stale native champion schema",
);
for (const [name, h] of Object.entries(native.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === h,
    `Native schema helper changed: ${name}`,
  );
for (const [p, h] of Object.entries(native.inputs))
  check(sha(await raw(p)) === h, `Native schema input changed: ${p}`);
for (const b of native.originalBlocks)
  check(
    sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Original schema instructions changed",
  );
const sourcePackets = new Map(replication.records.map((p) => [p.key, p])),
  expectedUpdates = [];
let groupChecks = 0,
  consumerChecks = 0,
  byteChecks = 0;
for (const probe of native.wireProbes) {
  const got = reader.championState({
    groups: [{ group: probe.group, mask: probe.mask, dataHex: probe.dataHex }],
  }).groups[0];
  const { dataHex, ...expected } = probe;
  check(
    JSON.stringify(got) === JSON.stringify(expected),
    `Native diagnostic varuint/float differs: ${dataHex}`,
  );
}
let rejectionChecks = 0;
for (const groups of [
  [{ group: 32, mask: 1 << 28, dataHex: "80" }],
  [{ group: 32, mask: 1, dataHex: "fe0001" }],
  [{ group: 32, mask: 0, dataHex: "00" }],
  [{ group: 64, mask: 1, dataHex: "00" }],
]) {
  let rejected = false;
  try {
    reader.championState({ groups });
  } catch {
    rejected = true;
  }
  check(rejected, "Malformed/unknown champion field was accepted");
  rejectionChecks++;
}
for (const observed of native.records) {
  const record = sourcePackets.get(observed.packetKey).records[
      observed.recordIndex
    ],
    decoded = reader.championState(record);
  check(
    record.entityId === observed.entityId &&
      JSON.stringify(decoded.groups) === JSON.stringify(observed.groups),
    "Native full champion group differs",
  );
  check(
    sorted(decoded.consumerBits) === sorted(observed.consumerBits),
    "Native champion consumer differs",
  );
  groupChecks += decoded.groups.length;
  consumerChecks += Object.keys(decoded.consumerBits).length;
  byteChecks += decoded.groups.reduce((n, g) => n + g.consumed, 0);
  if (Object.keys(decoded.values).length)
    expectedUpdates.push({
      entityId: observed.entityId,
      time: observed.time,
      ...decoded.values,
    });
}
check(
  expectedUpdates.length === report.championStateUpdates.length,
  "Worker state coverage differs",
);
for (const [i, expected] of expectedUpdates.entries()) {
  const got = report.championStateUpdates[i],
    fields = { entityId: got.entityId, time: got.time };
  for (const name of CHAMPION_STATE_FIELDS)
    if (Object.hasOwn(got, name)) fields[name] = got[name];
  check(sorted(fields) === sorted(expected), `Worker state differs: ${i}`);
}
let legacyChecks = 0;
for (const [key, value] of Object.entries(old)) {
  if (key === "summary") {
    for (const [k, v] of Object.entries(value))
      check(report.summary[k] === v, `Legacy summary changed: ${k}`);
  } else
    check(
      JSON.stringify(report[key]) === JSON.stringify(value),
      `Legacy report field changed: ${key}`,
    );
  legacyChecks++;
}
const state = createLatestReplayState(report),
  lifecycle = prepareLatestLifecycle(report),
  times = [
    ...new Set([
      0,
      120,
      ...report.championStateUpdates.map((u) => u.time),
      ...report.lifecycle.flatMap((e) => [
        Math.max(0, e.time - 0.001),
        e.time,
        Math.min(120, e.time + 0.001),
      ]),
    ]),
  ].sort((a, b) => a - b),
  presentations = new Map(),
  cases = [],
  samples = new Map(),
  fieldObservations = Object.fromEntries(
    CHAMPION_STATE_FIELDS.map((k) => [k, 0]),
  );
for (const u of report.championStateUpdates)
  for (const k of CHAMPION_STATE_FIELDS)
    if (Object.hasOwn(u, k)) fieldObservations[k]++;
for (const hero of report.heroes) {
  const asset =
      scene.champions[`${hero.champion.toLowerCase()}/${hero.skinId}`],
    catalog = await json(`${cache}/public/latest-scene/${asset.spellCatalog}`);
  presentations.set(
    hero.entityId,
    primaryResourcePresentation(
      catalog,
      asset.characterRecords,
      meta.primaryResourceDefaults,
    ),
  );
}
let snapshotChecks = 0,
  deathChecks = 0,
  respawnChecks = 0,
  nameChecks = 0;
for (const t of times) {
  const snapshot = state.sampleReplay(t);
  for (const hero of report.heroes) {
    const s = snapshot.entities.get(hero.entityId),
      values = Object.fromEntries(CHAMPION_STATE_FIELDS.map((k) => [k, null]));
    for (const u of report.championStateUpdates
      .filter((u) => u.entityId === hero.entityId && u.time <= t)
      .sort(
        (a, b) =>
          a.time - b.time ||
          a.transportSequence - b.transportSequence ||
          a.recordIndex - b.recordIndex,
      ))
      for (const k of CHAMPION_STATE_FIELDS)
        if (Object.hasOwn(u, k)) values[k] = u[k];
    for (const k of CHAMPION_STATE_FIELDS)
      check(
        s[k] === values[k],
        `Sparse state differs: ${hero.champion}/${k}/${t}`,
      );
    check(
      s.dead ===
        sampleLatestLifecycle(lifecycle.tracks.get(hero.entityId), t).dead,
      "Lifecycle state differs",
    );
    snapshotChecks++;
  }
  samples.set(t, JSON.stringify([...snapshot.entities.values()]));
}
for (const t of [...times].reverse())
  check(
    JSON.stringify([...state.sampleReplay(t).entities.values()]) ===
      samples.get(t),
    "Reverse seek changed state",
  );
for (const hero of report.heroes) {
  const id = report.playerIdentities.find((x) => x.entityId === hero.entityId);
  check(
    id.slot === hero.slot &&
      id.source === "rofl-footer-slot" &&
      state.sampleEntity(hero.entityId, 0).playerName === id.identity.gameName,
    "Player name slot binding differs",
  );
  nameChecks++;
  for (const interval of lifecycle.tracks.get(hero.entityId) ?? []) {
    const s = state.sampleEntity(hero.entityId, interval.death.time),
      d = championPlateDrawing(
        s.playerName,
        hero.team,
        s,
        presentations.get(hero.entityId),
      );
    check(
      !d.visible && !championPlateSvg(d).includes("<text"),
      "Dead unit retains nameplate",
    );
    deathChecks++;
    if (interval.respawn) {
      const s = state.sampleEntity(hero.entityId, interval.respawn.time);
      check(
        championPlateDrawing(
          s.playerName,
          hero.team,
          s,
          presentations.get(hero.entityId),
        ).visible,
        "Respawn lost nameplate",
      );
      respawnChecks++;
    }
  }
}
for (const t of [0, 45, 60, 90, 105, 120])
  for (const hero of report.heroes) {
    const s = state.sampleEntity(hero.entityId, t),
      presentation = presentations.get(hero.entityId);
    cases.push({
      champion: hero.champion,
      time: t,
      team: hero.team,
      state: s,
      presentation,
      drawing: championPlateDrawing(s.playerName, hero.team, s, presentation),
    });
  }
const firstDeath = report.lifecycle.find(
    (e) =>
      e.kind === "death-candidate" &&
      report.heroes.some((h) => h.entityId === e.entityId),
  ),
  hero = report.heroes.find((h) => h.entityId === firstDeath.entityId),
  interval = lifecycle.tracks.get(hero.entityId)[0];
for (const t of [
  firstDeath.time - 0.1,
  firstDeath.time + 0.1,
  interval.respawn.time + 0.1,
]) {
  const s = state.sampleEntity(hero.entityId, t),
    presentation = presentations.get(hero.entityId);
  cases.push({
    champion: hero.champion,
    time: t,
    team: hero.team,
    state: s,
    presentation,
    transition: true,
    drawing: championPlateDrawing(s.playerName, hero.team, s, presentation),
  });
}
check(
  groupChecks === native.counts.nativeGroups &&
    consumerChecks === native.counts.consumerChecks &&
    byteChecks === native.counts.nativeBytes,
  "Native champion corpus incomplete",
);
const sources = {};
for (const name of [
  "latest-champion-state.mjs",
  "latest-state-fields.mjs",
  "latest-replication.mjs",
  "latest-replay-state.mjs",
  "latest-overhead.mjs",
  "latest-reconstruction.mjs",
  "latest-viewer.mjs",
  "structural-check-worker.mjs",
  "transport.mjs",
  "latest-lifecycle.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const counts = {
  groupChecks,
  consumerChecks,
  byteChecks,
  updates: report.championStateUpdates.length,
  snapshotChecks,
  reverseSeekChecks: times.length,
  deathChecks,
  respawnChecks,
  nameChecks,
  legacyChecks,
  registeredFields: native.counts.registeredFields,
  wireProbeChecks: native.wireProbes.length,
  rejectionChecks,
  fieldObservations,
};
await Bun.write(
  `${cache}/research/champion-state-comparison.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "champion-state-native-js-comparison",
      build: report.build,
      protocol: report.protocol,
      packageSha256: sha(packageBytes),
      nativeEvidenceSha256: inputs[nativePath],
      inspectorSha256: sha(await raw(import.meta.path)),
      inputs,
      sources,
      counts,
      cases,
      scope: {
        mainViewerSourceIntegrated: true,
        browserRun: false,
        leagueAvCompared: false,
        layoutReferenceVerified: false,
        shieldSemanticsVerified: false,
        nativeSchemaExecuted: true,
        fullChampionGroupsParsed: true,
      },
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(counts));
