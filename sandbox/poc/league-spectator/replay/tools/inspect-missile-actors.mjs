// Original actor phase/component operations versus browser-compatible functions.
// No browser or League process is launched.
import { resolve } from "node:path";
import { createLatestMissileActors } from "../latest-missile-actors.mjs";

const [decoderPath, missilePath, nativePath, outputPath] =
  process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-missile-actors.mjs <decoder> <missiles.json> <native-actors.json> <evidence.json>",
  );
const decoder = resolve(decoderPath),
  profile = await Bun.file(`${decoder}/profile.json`).json(),
  definitionBytes = await Bun.file(
    `${decoder}/missile-actors.json`,
  ).arrayBuffer(),
  missileBytes = await Bun.file(missilePath).arrayBuffer(),
  nativeBytes = await Bun.file(nativePath).arrayBuffer(),
  hash = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  decode = (bytes) => JSON.parse(new TextDecoder().decode(bytes)),
  missiles = decode(missileBytes),
  native = decode(nativeBytes),
  definition = decode(definitionBytes);
if (
  native.build !== profile.clientVersion ||
  native.protocol !== profile.protocolDigest ||
  native.decoderImageSha256 !== profile.decoderImageSha256 ||
  native.fieldCodecsSha256 !== profile.fieldCodecsSha256 ||
  missiles.fieldCodecsSha256 !== native.fieldCodecsSha256 ||
  native.actorDefinitionSha256 !== hash(definitionBytes) ||
  hash(definitionBytes) !== profile.missileActorsSha256 ||
  native.missileInputsSha256 !== hash(missileBytes) ||
  missiles.missileActorsSha256 !== profile.missileActorsSha256
)
  throw Error("Native actor comparison source mismatch");
const actors = createLatestMissileActors(definition),
  bySequence = new Map(missiles.records.map((r) => [r.sequence, r])),
  eventsBySequence = new Map(
    missiles.eventIndex.identities
      .flatMap((identity) => identity.events)
      .map((event) => [event.sequence, event]),
  ),
  admitted = missiles.records.filter(
    (r) => !actors.settings(r.behaviorSpecs).reasons.length,
  ),
  scalarBits = (n) => new Uint32Array(new Float32Array([n]).buffer)[0],
  canonical = (value) =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [
                key,
                key === "velocity"
                  ? value[key].map(scalarBits)
                  : canonical(value[key]),
              ]),
          )
        : value,
  same = (a, b) =>
    JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)),
  mismatches = [];
let initialMatches = 0,
  operationMatches = 0,
  recordedOperations = 0,
  recordedPhaseNotifications = 0,
  recordedStops = 0,
  nonzeroInitialPhases = 0;
for (const [kind, cases] of [
  ["recorded", native.cases],
  ["diagnostic", native.diagnostics],
]) {
  for (const sample of cases) {
    const record = sample.record;
    if (kind === "recorded") {
      const original = bySequence.get(record.sequence);
      if (
        !original ||
        record.entityId !== original.entityId ||
        record.payloadSha256 !== original.payloadSha256 ||
        record.pendingChildren !== original.pendingChildren ||
        record.replicationPhase !== original.replicationPhase ||
        !same(record.behaviorSpecs, original.behaviorSpecs)
      )
        throw Error("Actor probe differs from recorded input");
      if (record.replicationPhase) nonzeroInitialPhases++;
    }
    const state = actors.initialize(record, sample.initialVelocity);
    if (!same(actors.snapshot(state), sample.initial)) {
      mismatches.push({
        kind,
        record,
        phase: "initialization",
        expected: sample.initial,
        actual: actors.snapshot(state),
      });
      continue;
    }
    initialMatches++;
    for (const [index, operation] of sample.operations.entries()) {
      if (kind === "recorded") {
        const event = eventsBySequence.get(operation.sequence);
        if (
          !event ||
          event.time !== operation.time ||
          event.entityId !== record.entityId ||
          (event.opcode === 56
            ? operation.type !== "phase-notification" ||
              operation.target !== event.target
            : event.opcode !== 497 || operation.type !== "stop-notification")
        )
          throw Error("Native actor notification differs from recorded event");
      }
      switch (operation.type) {
        case "phase-notification":
          actors.phaseNotification(state, operation.target);
          break;
        case "stop-notification":
          actors.stop(state);
          break;
        case "release-child-gate":
          actors.releaseChildGate(state);
          break;
        case "post-movement-fragment":
          actors.afterMovement(state, operation.arrived);
          break;
        default:
          throw Error("Unknown native actor comparison operation");
      }
      const actual = actors.snapshot(state);
      if (!same(actual, operation.state)) {
        mismatches.push({ kind, record, index, operation, actual });
        break;
      }
      operationMatches++;
      if (kind === "recorded") {
        recordedOperations++;
        if (operation.type === "phase-notification")
          recordedPhaseNotifications++;
        if (operation.type === "stop-notification") recordedStops++;
      }
    }
  }
}
if (
  !same(
    admitted.map((r) => r.sequence),
    native.admittedSequences,
  ) ||
  native.cases.length !== admitted.length
)
  throw Error("Native/browser actor phase admission disagreement");
const result = {
  schema: 1,
  build: native.build,
  protocol: native.protocol,
  decoderImageSha256: native.decoderImageSha256,
  fieldCodecsSha256: native.fieldCodecsSha256,
  actorDefinitionSha256: hash(definitionBytes),
  missileInputsSha256: hash(missileBytes),
  nativeEvidenceSha256: hash(nativeBytes),
  eventSources: native.eventSources,
  actorSourceSha256: hash(
    await Bun.file(
      new URL("../latest-missile-actors.mjs", import.meta.url),
    ).arrayBuffer(),
  ),
  records: native.cases.length,
  diagnosticCases: native.diagnostics.length,
  initialMatches,
  operationMatches,
  recordedOperations,
  recordedPhaseNotifications,
  recordedStops,
  nonzeroInitialPhases,
  boundSpells: [
    ...new Set(admitted.map((r) => `${r.ownerCharacter}/${r.definitionName}`)),
  ],
  services: native.services,
  skipped: native.skipped,
  mismatches,
  scope:
    "Original phase/stop/component callbacks agree with browser-compatible code on owned no-child actors. Recorded notifications omit intervening movement phases; controlled branch probes are not observed gameplay. Actor registries, collision/hit/cast dispatch, full lifecycle and rendered A/V remain separate",
};
await Bun.write(outputPath, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    records: result.records,
    diagnosticCases: result.diagnosticCases,
    initialMatches,
    operationMatches,
    recordedOperations,
    nonzeroInitialPhases,
    mismatches: mismatches.length,
  }),
);
if (mismatches.length) throw Error("Native/browser actor phase disagreement");
