import { sha256 } from "./structural-comparison.mjs";
import { ownLatestStaticBytes } from "./latest-static-bytes.mjs";
import {
  prepareLatestLifecycle,
  sampleLatestLifecycle,
} from "./latest-lifecycle.mjs";
import { CORPSE_POLICY_SHA } from "./latest-corpse-contract.mjs";
import { assertLatestSelectedCorpse } from "./latest-selected-corpse.mjs";
export { CORPSE_POLICY_SHA } from "./latest-corpse-contract.mjs";
const policies = new WeakMap();
const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

// The native lifetime getter and strict frame-retention comparison are recovered.
// The browser supplies its replay clock; original live-clock/frame scheduling,
// animation, fading and physical object deletion are separate components.
export async function createLatestCorpsePolicy(
  profile,
  sceneBytes,
  worldBytes,
  bytes,
  staticCatalog = null,
) {
  sceneBytes = ownLatestStaticBytes(sceneBytes);
  worldBytes = ownLatestStaticBytes(worldBytes);
  bytes = ownLatestStaticBytes(bytes);
  const packageSha256 = await sha256(bytes);
  if (staticCatalog !== null)
    await assertLatestSelectedCorpse({
      selection: staticCatalog,
      profile,
      packageBytes: bytes,
      sceneBytes,
      worldBytes,
    });
  else if (packageSha256 !== CORPSE_POLICY_SHA)
    throw Error("Pinned corpse policy required");
  const meta = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  if (
    meta.schema !== 1 ||
    meta.kind !== "native-minion-corpse-policy" ||
    meta.build !== "16.21.829.8620" ||
    meta.protocol !== "20e09df23c66b85e" ||
    meta.build !== profile.clientVersion ||
    meta.protocol !== profile.protocolDigest ||
    meta.decoderImageSha256 !== profile.decoderImageSha256 ||
    meta.sliceSha256 !== profile.sliceSha256 ||
    (await sha256(sceneBytes)) !== meta.sceneManifestSha256 ||
    (await sha256(worldBytes)) !== meta.worldCatalogSha256 ||
    meta.clockFrequencyInput !== 1000000000 ||
    meta.ticksToSeconds !== 1e-9
  )
    throw Error("Unsupported corpse policy/assets");
  function duration(value) {
    if (!Number.isFinite(value))
      throw Error("Invalid authored corpse lifetime");
    const nativeValue = Math.fround(value);
    if (!Number.isFinite(nativeValue))
      throw Error("Corpse lifetime outside float32");
    return nativeValue < 0 ? meta.minionDeathTimeDefault : nativeValue;
  }
  function retainsTicks(dead, ticks, deathTime) {
    if (typeof dead !== "boolean" || !Number.isSafeInteger(ticks) || ticks < 0)
      throw Error("Invalid corpse stopwatch input");
    const limit = duration(deathTime),
      age = Math.fround(ticks * meta.ticksToSeconds);
    return { retained: !dead || age <= limit, age, duration: limit };
  }
  function bind(asset, recordPaths) {
    const prepared = meta.assets[asset];
    if (!prepared || !Array.isArray(recordPaths) || !recordPaths.length)
      throw Error("Unprepared corpse asset/character record");
    const values = recordPaths.map((name) => {
      const row = prepared.records[name];
      if (!row || duration(row.deathTime) !== row.duration)
        throw Error("Corpse character record not admitted");
      return row.duration;
    });
    if (new Set(values).size !== 1)
      throw Error("Runtime corpse character variant remains unresolved");
    return values[0];
  }
  function modeFromRaw(value) {
    if (!Number.isInteger(value) || value < 0 || value > 255)
      throw Error("Invalid unit death-mode byte");
    return meta.unitDeathMode.setsDeadFlag[value];
  }
  function readUnitDeath(observation) {
    const object = observation.object;
    if (
      !observation.complete ||
      !(object instanceof Uint8Array) ||
      object.length !== meta.unitDeathMode.objectSize
    )
      throw Error("Incomplete unit death-mode packet");
    const view = new DataView(
        object.buffer,
        object.byteOffset,
        object.byteLength,
      ),
      entityId = view.getUint32(12, true),
      rawModeByte = object[meta.unitDeathMode.rawOffset];
    if (view.getUint32(8, true) !== 514 || !entityId)
      throw Error("Wrong unit death-mode packet");
    return { entityId, rawModeByte, setsDeadFlag: modeFromRaw(rawModeByte) };
  }
  const policy = Object.freeze({
    packageSha256,
    metadata: freeze(structuredClone(meta)),
    duration,
    retainsTicks,
    bind,
    modeFromRaw,
    readUnitDeath,
  });
  policies.set(policy, packageSha256);
  return policy;
}

export function createLatestMinionCorpsePlayback(report, policy, bindings) {
  if (
    !policies.has(policy) ||
    report.build !== policy.metadata.build ||
    report.protocol !== policy.metadata.protocol ||
    report.corpsePolicyPackageSha256 !== policies.get(policy) ||
    !Array.isArray(report.corpseDeathStates)
  )
    throw Error("Corpse policy and replay differ");
  const lifecycle = prepareLatestLifecycle(report),
    modes = new Map(),
    subjects = new Map();
  for (const event of report.corpseDeathStates) {
    const source = report.lifecycle.find((e) => e.sequence === event.sequence);
    if (
      !source ||
      source.opcode !== 514 ||
      source.entityId !== event.entityId ||
      source.time !== event.time ||
      source.chunkId !== event.chunkId ||
      source.blockOffset !== event.blockOffset ||
      modes.has(event.sequence) ||
      policy.modeFromRaw(event.rawModeByte) !== event.setsDeadFlag
    )
      throw Error("Invalid unit death-mode provenance");
    modes.set(event.sequence, event);
  }
  for (const binding of bindings.minions) {
    const id = binding.event.entityId,
      entity = report.worldEntities.find((e) => e.entityId === id),
      duration = policy.bind(binding.unit.asset, [
        ...new Set(binding.unit.records.map((r) => r.characterRecord)),
      ]),
      track = lifecycle.tracks.get(id);
    if (
      !entity ||
      entity.entityClass !== "lane-minion" ||
      subjects.has(id) ||
      entity.creationTime !== binding.event.time
    )
      throw Error("Corpse subject is not an admitted minion");
    if (track?.some((interval) => interval.postDeathActions.length))
      throw Error("Post-death minion actions require another lifecycle policy");
    subjects.set(id, { creationTime: entity.creationTime, duration, track });
    if (
      track?.some(
        (interval) => !modes.get(interval.death.sequence)?.setsDeadFlag,
      )
    )
      throw Error(
        "Special or unobserved minion death mode requires another corpse policy",
      );
  }
  return {
    sample(entityId, time) {
      const subject = subjects.get(entityId);
      if (
        !subject ||
        !Number.isFinite(time) ||
        time < 0 ||
        time > report.endTime
      )
        throw Error("Corpse query outside admitted replay");
      if (time < subject.creationTime)
        return {
          visible: false,
          status: "Not spawned",
          duration: subject.duration,
          age: null,
        };
      const life = sampleLatestLifecycle(subject.track, time);
      if (!life.dead)
        return {
          visible: true,
          status: "Alive",
          duration: subject.duration,
          age: null,
        };
      // Quantization belongs to this explicit replay-clock projection. It is not
      // a claim to have recovered the original macOS stopwatch's input ticks.
      const ticks =
          Math.round(time * policy.metadata.clockFrequencyInput) -
          Math.round(
            life.interval.death.time * policy.metadata.clockFrequencyInput,
          ),
        result = policy.retainsTicks(true, ticks, subject.duration);
      return {
        visible: result.retained,
        status: result.retained ? "Corpse" : "Retired corpse",
        duration: result.duration,
        age: result.age,
      };
    },
  };
}
