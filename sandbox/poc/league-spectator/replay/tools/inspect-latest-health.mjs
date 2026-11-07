import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { StructuralDecoder } from "../structural-decoder.mjs";
import { createLatestReplicationReader } from "../latest-replication.mjs";
import { createLatestReplayState } from "../latest-replay-state.mjs";
import {
  prepareLatestLifecycle,
  sampleLatestLifecycle,
} from "../latest-lifecycle.mjs";
import { championPlateDrawing, championPlateSvg } from "../latest-overhead.mjs";
const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: inspect-latest-health.mjs <cache>");
const cache = resolve(cacheArg),
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
  hex = (b) => Buffer.from(b).toString("hex"),
  requireThat = (v, m) => {
    if (!v) throw Error(m);
  };
const native = await json(`${cache}/research/latest-replication-native.json`),
  samples = await json(`${cache}/research/latest-replication-input.json`),
  objects = await json(
    `${cache}/research/latest-replication-objects-native.json`,
  ),
  report = await json(`${cache}/research/latest-semantics-health.json`),
  old = await json(`${cache}/research/latest-semantics-creations.json`),
  profile = await json(`${dec}/profile.json`),
  image = await raw(`${dec}/image.bin`),
  constructors = await raw(`${dec}/constructors.bin`),
  packageBytes = await raw(`${cache}/public/latest-replication/package.json`),
  vendor = `${cache}/public/vendor/unicorn_x86_candidate.mjs`;
requireThat(
  sha(packageBytes) === native.packageSha256 &&
    sha(await raw(`${root}/tools/prepare-latest-replication.py`)) ===
      native.preparerSha256,
  "Native health preparer/package changed",
);
for (const [p, h] of Object.entries(native.inputs))
  requireThat(sha(await raw(p)) === h, `Native health input changed: ${p}`);
requireThat(
  sha(await raw(vendor)) ===
    "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716",
  "Health WASM runtime changed",
);
const { default: createUnicorn } = await import(pathToFileURL(vendor).href),
  uc = await createUnicorn(),
  reader = await createLatestReplicationReader(profile, image, packageBytes),
  structural = new StructuralDecoder(uc, profile, image, constructors),
  heroIds = new Set(report.heroes.map((h) => h.entityId)),
  expectedUpdates = [];
let packetChecks = 0,
  prefixChecks = 0,
  byteChecks = 0;
try {
  for (const p of native.records) {
    const sample = samples.packets[p.key],
      o = objects.observations[p.key],
      observation = structural.observePacket(
        26,
        Buffer.from(sample.payloadHex, "hex"),
        sample.param,
      );
    requireThat(
      observation.complete &&
        hex(observation.object) === o.object &&
        hex(observation.heap) === o.heap,
      `WASM health packet differs: ${p.key}`,
    );
    const records = reader.read(observation);
    requireThat(
      records.length === p.records.length,
      "WASM replication record count differs",
    );
    for (let i = 0; i < records.length; i++) {
      const got = records[i],
        want = p.records[i];
      requireThat(
        got.entityId === want.entityId &&
          got.offset === want.offset &&
          got.groups.length === want.groups.length,
        "Replication header differs",
      );
      for (let j = 0; j < got.groups.length; j++) {
        const a = got.groups[j],
          b = want.groups[j];
        requireThat(
          ["group", "mask", "dataHex"].every((k) => a[k] === b[k]),
          "Replication body differs",
        );
        if (Object.hasOwn(b, "nativeFieldBits")) {
          const h = reader.championHealth(got);
          requireThat(
            heroIds.has(got.entityId) &&
              h.consumedPrefixBytes === b.nativePrefixBytes &&
              JSON.stringify(h.fieldBits) === JSON.stringify(b.nativeFieldBits),
            "Native health prefix differs",
          );
          prefixChecks++;
          byteChecks += h.consumedPrefixBytes;
          if (Object.keys(h.values).length)
            expectedUpdates.push({
              entityId: got.entityId,
              time: p.time,
              ...h.values,
            });
        }
      }
    }
    packetChecks++;
  }
} finally {
  structural.close();
}
requireThat(
  JSON.stringify(expectedUpdates) ===
    JSON.stringify(
      report.healthUpdates.map(
        ({ entityId, time, currentHealth, maxHealth }) => ({
          entityId,
          time,
          ...(currentHealth === undefined ? {} : { currentHealth }),
          ...(maxHealth === undefined ? {} : { maxHealth }),
        }),
      ),
    ),
  "Worker composition lost health observations",
);
let legacyFields = 0;
for (const [key, value] of Object.entries(old)) {
  if (["summary", "decodedPackets", "unhandledOpcodes"].includes(key)) continue;
  requireThat(
    JSON.stringify(report[key]) === JSON.stringify(value),
    `Legacy replay field changed: ${key}`,
  );
  legacyFields++;
}
for (const [key, value] of Object.entries(old.summary))
  requireThat(report.summary[key] === value, `Legacy summary changed: ${key}`);
for (const [key, value] of Object.entries(old.decodedPackets))
  requireThat(
    report.decodedPackets[key] === value,
    `Legacy packet count changed: ${key}`,
  );
for (const [key, value] of Object.entries(old.unhandledOpcodes))
  if (key !== "26")
    requireThat(
      report.unhandledOpcodes[key] === value,
      "Unrelated unhandled opcode changed",
    );
requireThat(
  !Object.hasOwn(report.unhandledOpcodes, "26") &&
    report.decodedPackets[26] === packetChecks,
  "Health packet coverage differs",
);
const runtime = createLatestReplayState(report),
  life = prepareLatestLifecycle(report),
  times = [
    ...new Set([
      0,
      report.endTime,
      ...report.healthUpdates.map((u) => u.time),
      ...report.lifecycle.flatMap((e) => [
        Math.max(0, e.time - 0.001),
        e.time,
        Math.min(report.endTime, e.time + 0.001),
      ]),
    ]),
  ].sort((a, b) => a - b),
  forward = new Map();
let stateChecks = 0,
  hiddenDeathChecks = 0,
  respawnChecks = 0;
for (const t of times) {
  const snapshot = runtime.sampleReplay(t),
    expected = [];
  for (const h of report.heroes) {
    const values = { currentHealth: null, maxHealth: null };
    for (const u of report.healthUpdates
      .filter((u) => u.entityId === h.entityId && u.time <= t)
      .sort(
        (a, b) =>
          a.time - b.time ||
          a.transportSequence - b.transportSequence ||
          a.recordIndex - b.recordIndex,
      ))
      for (const k of Object.keys(values))
        if (Object.hasOwn(u, k)) values[k] = u[k];
    const s = snapshot.entities.get(h.entityId);
    requireThat(
      s.currentHealth === values.currentHealth &&
        s.maxHealth === values.maxHealth &&
        s.dead === sampleLatestLifecycle(life.tracks.get(h.entityId), t).dead,
      "Absolute health state differs from event replay",
    );
    expected.push(s);
    stateChecks++;
  }
  forward.set(t, JSON.stringify(expected));
}
for (const t of [...times].reverse())
  requireThat(
    JSON.stringify([...runtime.sampleReplay(t).entities.values()]) ===
      forward.get(t),
    "Backward seek changed champion state",
  );
for (const h of report.heroes)
  for (const interval of life.tracks.get(h.entityId) ?? []) {
    const dead = runtime.sampleEntity(h.entityId, interval.death.time),
      drawing = championPlateDrawing(h.champion, h.team, dead);
    requireThat(
      !drawing.visible && !championPlateSvg(drawing).includes("<text"),
      "Dead champion retains overhead UI",
    );
    hiddenDeathChecks++;
    if (interval.respawn) {
      requireThat(
        championPlateDrawing(
          h.champion,
          h.team,
          runtime.sampleEntity(h.entityId, interval.respawn.time),
        ).visible,
        "Respawn did not restore overhead UI",
      );
      respawnChecks++;
    }
  }
const cases = [];
for (const t of [0, 45, 60, 90, 105, 120])
  for (const h of report.heroes) {
    const s = runtime.sampleEntity(h.entityId, t);
    cases.push({
      champion: h.champion,
      team: h.team,
      time: t,
      state: s,
      drawing: championPlateDrawing(h.champion, h.team, s),
    });
  }
const firstDeath = report.lifecycle.find(
    (e) => e.kind === "death-candidate" && heroIds.has(e.entityId),
  ),
  h = report.heroes.find((h) => h.entityId === firstDeath.entityId),
  interval = life.tracks.get(h.entityId)[0];
for (const t of [
  Math.max(0, firstDeath.time - 0.1),
  firstDeath.time + 0.1,
  interval.respawn.time + 0.1,
]) {
  const s = runtime.sampleEntity(h.entityId, t);
  cases.push({
    champion: h.champion,
    team: h.team,
    time: t,
    state: s,
    drawing: championPlateDrawing(h.champion, h.team, s),
    transition: true,
  });
}
const sources = {};
for (const name of [
  "latest-replication.mjs",
  "latest-replay-state.mjs",
  "latest-overhead.mjs",
  "latest-reconstruction.mjs",
  "latest-viewer.mjs",
  "structural-check-worker.mjs",
  "structural-decoder.mjs",
  "native-decoder.mjs",
  "latest-lifecycle.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const counts = {
  packetChecks,
  prefixChecks,
  nativePrefixBytes: byteChecks,
  healthUpdates: report.healthUpdates.length,
  stateChecks,
  reverseSeekChecks: times.length,
  hiddenDeathChecks,
  respawnChecks,
  legacyFields,
};
await Bun.write(
  `${cache}/research/latest-health-comparison.json`,
  JSON.stringify(
    {
      schema: 1,
      kind: "latest-champion-health-comparison",
      build: report.build,
      protocol: report.protocol,
      packageSha256: native.packageSha256,
      inputs,
      sources,
      inspectorSha256: sha(await raw(import.meta.path)),
      counts,
      cases,
      scope: {
        mainViewerSourceIntegrated: true,
        browserRun: false,
        leagueAvCompared: false,
        shieldSemanticsVerified: false,
        layoutReferenceVerified: false,
      },
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(counts));
