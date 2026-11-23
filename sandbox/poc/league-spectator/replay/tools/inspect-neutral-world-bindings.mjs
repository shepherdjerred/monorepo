import path from "node:path";
import assert from "node:assert/strict";
import { bindLatestNeutralMinions } from "../latest-neutral-world.mjs";
import { decodeRegisteredState } from "../latest-state-fields.mjs";
import { prepareLatestLifecycle } from "../latest-lifecycle.mjs";
import { createLatestWorldStateReader } from "../latest-world-state.mjs";
import {
  createLatestCorpsePolicy,
  createLatestMinionCorpsePlayback,
} from "../latest-corpse.mjs";
import { createLatestReplayState } from "../latest-replay-state.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const [reportArg, sceneArg, outputArg, option, decoderArg] =
  process.argv.slice(2);
if (
  !outputArg ||
  ![5, 7].includes(process.argv.length) ||
  (process.argv.length === 7 && (option !== "--decoder-root" || !decoderArg))
)
  throw Error(
    "Usage: bun inspect-neutral-world-bindings.mjs <complete-semantic-report> <runtime/public/latest-scene> <output.json> [--decoder-root <approved-decoder>]",
  );
const inputs = {},
  sha = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
async function digestFile(file) {
  const hash = new Bun.CryptoHasher("sha256");
  for await (const bytes of Bun.file(file).stream()) hash.update(bytes);
  return hash.digest("hex");
}
async function read(file) {
  inputs[path.resolve(file)] = await digestFile(file);
  return Bun.file(file).json();
}
async function raw(file) {
  inputs[path.resolve(file)] = await digestFile(file);
  return Bun.file(file).bytes();
}
await captureDirectSourceInputs([import.meta.path], raw);
const scene = await read(path.join(sceneArg, "manifest.json")),
  world = await read(path.join(sceneArg, scene.world)),
  state = await read(path.join(sceneArg, "../latest-world-state/package.json")),
  corpse = await read(path.join(sceneArg, "../latest-corpse/package.json")),
  report = await read(reportArg),
  bindings = bindLatestNeutralMinions(report, scene, world);
if (
  state.kind !== "native-world-state-schema" ||
  corpse.kind !== "native-minion-corpse-policy" ||
  state.sceneManifestSha256 !==
    inputs[path.resolve(sceneArg, "manifest.json")] ||
  corpse.sceneManifestSha256 !== state.sceneManifestSha256 ||
  state.worldCatalogSha256 !== inputs[path.resolve(sceneArg, scene.world)] ||
  corpse.worldCatalogSha256 !== state.worldCatalogSha256 ||
  state.neutralCharacterRecordsProofSha256 !==
    world.neutralCreation.characterRecordProofSha256 ||
  corpse.neutralCharacterRecordsProofSha256 !==
    state.neutralCharacterRecordsProofSha256
)
  throw Error("Exact generated neutral world/health/corpse parents required");
const subjects = new Map();
for (const binding of bindings.minions) {
  const key = binding.unit.asset,
    rows = binding.unit.records.map(({ characterRecord }) => {
      const health = state.assets[key]?.records[characterRecord],
        lifetime = corpse.assets[key]?.records[characterRecord];
      if (!health || !lifetime)
        throw Error("Missing generated original neutral record: " + key);
      return { health, lifetime };
    });
  if (
    rows.some(
      (row) =>
        row.health.schema !== rows[0].health.schema ||
        row.health.healthBarHeight !== rows[0].health.healthBarHeight ||
        row.lifetime.durationBits !== rows[0].lifetime.durationBits,
    )
  )
    throw Error("Neutral runtime CharacterRecord form remains unresolved");
  subjects.set(binding.event.entityId, {
    entityId: binding.event.entityId,
    character: binding.event.character,
    skinId: binding.event.resourceSkinId,
    asset: key,
    creationTime: binding.event.time,
    position: binding.creationPosition,
    replicationSchema: rows[0].health.schema,
    healthBarHeight: rows[0].health.healthBarHeight,
    corpseDuration: rows[0].lifetime.duration,
    replicationRecords: 0,
    healthUpdates: 0,
  });
}
let replicationRecords = 0,
  healthUpdates = 0,
  beforeBirth = 0;
const earlyExamples = [];
for (const record of report.replicationRecords) {
  const subject = subjects.get(record.entityId);
  if (!subject) continue;
  if (record.time < subject.creationTime) {
    beforeBirth++;
    if (earlyExamples.length < 10)
      earlyExamples.push({
        entityId: record.entityId,
        time: record.time,
        creationTime: subject.creationTime,
        transportSequence: record.transportSequence,
      });
    continue;
  }
  const decoded = decodeRegisteredState(
    record,
    state.classes[subject.replicationSchema],
  );
  subject.replicationRecords++;
  replicationRecords++;
  if (Object.keys(decoded.values).length) {
    subject.healthUpdates++;
    healthUpdates++;
  }
}
const deathModes = new Map();
for (const mode of report.corpseDeathStates)
  if (subjects.has(mode.entityId)) {
    const key = String(mode.setsDeadFlag);
    deathModes.set(key, (deathModes.get(key) ?? 0) + 1);
  }
const lifecycle = prepareLatestLifecycle(report),
  neutralIntervals = [...lifecycle.tracks]
    .filter(([id]) => subjects.has(id))
    .flatMap(([entityId, intervals]) =>
      intervals.map((interval) => ({
        entityId,
        deathTime: interval.death.time,
        respawnTime: interval.respawn?.time ?? null,
        postDeathCasts: interval.postDeathActions.length,
      })),
    );
let factories = null;
if (decoderArg) {
  const profile = await read(path.join(decoderArg, "profile.json"));
  const sceneBytes = await raw(path.join(sceneArg, "manifest.json"));
  const worldBytes = await raw(path.join(sceneArg, scene.world));
  const reader = await createLatestWorldStateReader(
    profile,
    await raw(path.join(decoderArg, "image.bin")),
    await raw(path.join(sceneArg, "../latest-world-state/package.json")),
    sceneBytes,
    worldBytes,
  );
  const reconstructed = reader.reconstruct(report);
  const replayState = createLatestReplayState(report, reconstructed);
  const policy = await createLatestCorpsePolicy(
    profile,
    sceneBytes,
    worldBytes,
    await raw(path.join(sceneArg, "../latest-corpse/package.json")),
  );
  const corpsePackageSha256 =
    inputs[path.resolve(sceneArg, "../latest-corpse/package.json")];
  const corpsePlayback =
    report.corpsePolicyPackageSha256 === corpsePackageSha256
      ? createLatestMinionCorpsePlayback(report, policy, bindings)
      : null;
  const corpseCases = [];
  let queries = 0;
  for (const binding of bindings.minions) {
    const id = binding.event.entityId,
      creation = binding.event.time;
    const entity = reconstructed.entities.find((row) => row.entityId === id);
    if (entity?.entityClass !== "neutral-minion")
      throw Error("Native world reader omitted neutral binding");
    policy.bind(binding.unit.asset, [
      ...new Set(binding.unit.records.map((row) => row.characterRecord)),
    ]);
    const before = Math.max(0, creation - 0.001);
    for (const time of [before, creation, report.endTime, creation]) {
      const sample = replayState.sampleEntity(id, time);
      if (sample.present !== time >= creation || sample.team !== null)
        throw Error(
          "Neutral replay-state presence/team differs from original candidate",
        );
      queries++;
      if (corpsePlayback) corpseCases.push({ entityId: id, time });
    }
  }
  if (corpsePlayback) {
    for (const interval of neutralIntervals) {
      const subject = subjects.get(interval.entityId);
      for (const time of [
        interval.deathTime,
        interval.deathTime + subject.corpseDuration,
        interval.deathTime + subject.corpseDuration + 0.001,
        ...(interval.respawnTime === null ? [] : [interval.respawnTime]),
      ])
        if (time >= 0 && time <= report.endTime)
          corpseCases.push({ entityId: interval.entityId, time });
    }
    const expected = corpseCases.map((query) =>
      corpsePlayback.sample(query.entityId, query.time),
    );
    const independent = createLatestMinionCorpsePlayback(
      report,
      policy,
      bindings,
    );
    for (let index = corpseCases.length - 1; index >= 0; index--)
      assert.deepStrictEqual(
        independent.sample(
          corpseCases[index].entityId,
          corpseCases[index].time,
        ),
        expected[index],
      );
  }
  factories = {
    worldEntities: reconstructed.entities.length,
    worldUpdates: reconstructed.updates.length,
    neutralEntities: reconstructed.entities.filter(
      (row) => row.entityClass === "neutral-minion",
    ).length,
    replayStateQueries: queries,
    corpseRecordBindings: bindings.minions.length,
    runtimeCorpsePlaybackConstructed: corpsePlayback !== null,
    runtimeCorpseQueriesForwardAndBackward: corpseCases.length * 2,
    runtimeCorpsePlaybackBoundary: corpsePlayback
      ? null
      : "Fresh reconstruction must bind this exact corpse package; original report package identity is preserved",
  };
}
for (const [file, expected] of Object.entries(inputs))
  if ((await digestFile(file)) !== expected)
    throw Error("Neutral inspection input changed: " + file);
const result = {
  schema: 1,
  kind: "decoded-neutral-world-binding-inspection",
  build: report.build,
  protocol: report.protocol,
  inputs,
  gameplayCreations: bindings.minions.length,
  snapshotsRetainedSeparately: report.neutralSnapshots.length,
  subjects: [...subjects.values()],
  factories,
  replicationRecords,
  healthUpdates,
  replicationBeforeObservedBirth: beforeBirth,
  earlyExamples,
  deathModes: Object.fromEntries(deathModes),
  lifecycle: {
    intervals: neutralIntervals,
    postDeathCasts: neutralIntervals.reduce(
      (total, interval) => total + interval.postDeathCasts,
      0,
    ),
    repeatedDeaths: lifecycle.repeatedDeaths.filter((event) =>
      subjects.has(event.entityId),
    ).length,
    unmatchedRespawns: lifecycle.unmatchedRespawns.filter((event) =>
      subjects.has(event.entityId),
    ).length,
  },
  sources: Object.fromEntries(
    await Promise.all(
      [
        import.meta.path,
        new URL("../latest-neutral-world.mjs", import.meta.url),
        new URL("../latest-state-fields.mjs", import.meta.url),
        new URL("../latest-lifecycle.mjs", import.meta.url),
      ].map(async (file) => [String(file), sha(await Bun.file(file).bytes())]),
    ),
  ),
  scope: {
    logicalGameplayIdentityBinding: true,
    originalClassSchemaApplied: true,
    snapshotRestoration: false,
    nativeFactoryAccepted: false,
    renderedActors: false,
    liveClockOrNativeAvParity: false,
  },
};
await Bun.write(outputArg, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output: path.resolve(outputArg),
    gameplay: bindings.minions.length,
    snapshots: report.neutralSnapshots.length,
    replicationRecords,
    healthUpdates,
    beforeBirth,
    deathModes: result.deathModes,
    lifecycle: {
      intervals: neutralIntervals.length,
      postDeathCasts: result.lifecycle.postDeathCasts,
      repeatedDeaths: result.lifecycle.repeatedDeaths,
      unmatchedRespawns: result.lifecycle.unmatchedRespawns,
    },
    nativeFactoryAccepted: false,
  }),
);
