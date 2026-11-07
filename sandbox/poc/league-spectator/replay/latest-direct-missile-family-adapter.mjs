import { bindLatestMissileEffects } from "./latest-effects.mjs";
import { createProjectilePresentation } from "./latest-projectile-presentation.mjs";
import { isDirectImmutableData } from "./latest-direct-immutable-data.mjs";

export const DIRECT_MISSILE_FAMILY_POLICY =
  "verified-targeted-families-direct-partial-v2";
const omissions = Object.freeze([
  "resource:static-spell-binding-not-live-overlay-selection",
  "seed:zero-per-emitter-not-original-engine-rng",
  "clock:direct-absolute-60hz-not-original-client-frame-schedule",
  "world:missile-root-basis-unrecovered",
  "world:bound-object-size-unrecovered",
  "lifecycle:movement-stop-is-presentation-emission-stop",
  "lifecycle:original-particle-retirement-and-collision-unimplemented",
  "ownership:network-effect-duplicate-relation-unrecovered",
]);
const order = (a, b) =>
  a.time - b.time ||
  a.transportSequence - b.transportSequence ||
  a.entryOrder - b.entryOrder;
const sameMetadata = (actual, expected) => {
  if (expected === null || typeof expected !== "object")
    return Object.is(actual, expected);
  if (
    actual === null ||
    typeof actual !== "object" ||
    Array.isArray(actual) !== Array.isArray(expected)
  )
    return false;
  const keys = Reflect.ownKeys(expected);
  return (
    Reflect.ownKeys(actual).length === keys.length &&
    keys.every(
      (key) =>
        Object.hasOwn(actual, key) && sameMetadata(actual[key], expected[key]),
    )
  );
};

// This adapter consumes the existing strict, browser-generated movement
// families. It supplies their verified positions and admitted native effect
// basis; every other family's missing basis stays unresolved.
// Runtime component requirements still determine whether anything can render.
export function createLatestDirectMissileFamilyAdapter({
  report,
  manifest,
  presentation,
}) {
  if (
    report.build !== "16.21.829.8620" ||
    report.protocol !== "20e09df23c66b85e" ||
    !/^[a-f0-9]{64}$/.test(report.replaySha256) ||
    !presentation ||
    !Array.isArray(presentation.traces)
  )
    throw Error("Exact-build direct missile family inputs required");
  const source = structuredClone(presentation);
  const projectiles = createProjectilePresentation(report, source);
  const bindings = new Map(
    bindLatestMissileEffects(report, manifest).records.map((row) => [
      row.sequence,
      row,
    ]),
  );
  const records = new Map(report.missiles.map((row) => [row.sequence, row]));
  if (records.size !== report.missiles.length)
    throw Error("Distinct original missile replication sequences required");
  const entries = new Map(),
    events = [],
    omitted = [];
  for (const trace of source.traces) {
    const record = records.get(trace.sequence),
      binding = bindings.get(trace.sequence);
    if (
      trace.actualMatchMotionAccepted !== false ||
      !Number.isInteger(trace.ownerId) ||
      trace.ownerId <= 0 ||
      trace.ownerId > 0xffffffff
    )
      throw Error(
        "Explicit partial movement acceptance and decoded owner required",
      );
    const id = `direct-family-missile:${record.entityId}:${record.transportSequence}:${record.entryOrder ?? 0}`;
    const reasons = [];
    if (binding.status !== "prepared-definition")
      reasons.push(`resource:${binding.status}`);
    if (
      !Number.isFinite(trace.stopTime) ||
      trace.stopTime < trace.startTime ||
      trace.stopTime > source.endTime
    )
      reasons.push(
        "direct-missile-family:finite-admitted-stop-boundary-required",
      );
    if (reasons.length) {
      omitted.push({
        sequence: trace.sequence,
        entityId: trace.entityId,
        sourceEventId: trace.sourceEventId,
        reasons,
      });
      continue;
    }
    if (entries.has(trace.sequence))
      throw Error("Duplicate direct missile family ownership");
    const retainedOmissions = [
      ...trace.omissions.map((reason) =>
        reason ===
        "presentation:effect-resource-activation-and-rendering-not-in-this-trace"
          ? "source-trace:effect-resource-activation-and-rendering-excluded"
          : reason,
      ),
      ...omissions.filter(
        (reason) =>
          !(
            trace.effectBasisProgram &&
            reason === "world:missile-root-basis-unrecovered"
          ),
      ),
    ];
    const entry = {
      id,
      trace,
      record: structuredClone(record),
      binding,
      omissions: retainedOmissions,
    };
    entries.set(trace.sequence, entry);
    const shared = {
      origin: "missile",
      entityId: trace.entityId,
      ownerId: trace.ownerId,
      ownershipStatus: "decoded-cast-owner-under-direct-missile-family-policy",
      definitionId: binding.effectId,
      sourceEventId: trace.sourceEventId,
      transportSequence: record.transportSequence,
      entryOrder: record.entryOrder ?? 0,
      missilePresentation: {
        policy: DIRECT_MISSILE_FAMILY_POLICY,
        familyPolicy: trace.policy,
        sequence: trace.sequence,
        sourceEventId: trace.sourceEventId,
        requestedTargetEntityId: trace.requestedTargetEntityId,
        nativeAcceptance: null,
        omissions: retainedOmissions,
      },
    };
    events.push({
      ...shared,
      id,
      kind: "create",
      time: trace.startTime,
      seedHex: "0",
      resourceSelection: {
        presentation: {
          policy: DIRECT_MISSILE_FAMILY_POLICY,
          nativeAcceptance: null,
          definitionSha256: binding.definitionSha256,
          omissions: retainedOmissions,
          motionEvidence: {
            policy: trace.policy,
            sourceEventId: trace.sourceEventId,
            nativeAcceptance: null,
            nativeAcceptedInternalId: null,
          },
        },
      },
    });
    entry.missilePresentation = structuredClone(shared.missilePresentation);
    entry.resourceSelection = structuredClone(events.at(-1).resourceSelection);
    events.push({
      ...shared,
      id: `${id}:stop`,
      kind: "stop",
      time: trace.stopTime,
      orderingProvenance:
        "generated-movement-stop-under-family-clock-with-creation-source-ordinal",
    });
  }
  events.sort(order);
  const validatedEvents = new WeakSet();
  return Object.freeze({
    policy: DIRECT_MISSILE_FAMILY_POLICY,
    events: structuredClone(events),
    omitted: structuredClone(omitted),
    placement(event, time, cursor = null) {
      const row = entries.get(event.missilePresentation?.sequence);
      if (
        !validatedEvents.has(event) &&
        (!row ||
          event.kind !== "create" ||
          event.id !== row.id ||
          event.origin !== "missile" ||
          event.entityId !== row.trace.entityId ||
          event.ownerId !== row.trace.ownerId ||
          event.ownershipStatus !==
            "decoded-cast-owner-under-direct-missile-family-policy" ||
          event.descriptor !== undefined ||
          event.placement !== undefined ||
          event.definitionId !== row.binding.effectId ||
          event.sourceEventId !== row.trace.sourceEventId ||
          event.time !== row.trace.startTime ||
          event.transportSequence !== row.record.transportSequence ||
          event.entryOrder !== (row.record.entryOrder ?? 0) ||
          event.seedHex !== "0" ||
          event.missilePresentation.policy !== DIRECT_MISSILE_FAMILY_POLICY ||
          event.missilePresentation.familyPolicy !== row.trace.policy ||
          event.missilePresentation.requestedTargetEntityId !==
            row.trace.requestedTargetEntityId ||
          !sameMetadata(event.missilePresentation, row.missilePresentation) ||
          !sameMetadata(event.resourceSelection, row.resourceSelection))
      )
        throw Error("Owned direct missile family placement required");
      if (isDirectImmutableData(event)) validatedEvents.add(event);
      if (!Number.isFinite(time))
        throw Error("Finite missile family replay time required");
      if (time < row.trace.startTime || time > source.endTime)
        return {
          resolved: false,
          policy: DIRECT_MISSILE_FAMILY_POLICY,
          reasons: ["world:direct-missile-family-outside-admitted-prefix"],
        };
      const sampledTime = Math.min(time, row.trace.stopTime);
      const pose = projectiles.query(
        row.trace.entityId,
        sampledTime,
        sampledTime === time ? cursor : null,
      );
      if (!pose)
        return {
          resolved: false,
          policy: DIRECT_MISSILE_FAMILY_POLICY,
          reasons: ["world:direct-missile-family-position-unresolved"],
        };
      return {
        resolved: true,
        policy: DIRECT_MISSILE_FAMILY_POLICY,
        position: pose.position.map(Math.fround),
        basis: pose.basis === null ? null : pose.basis.map(Math.fround),
        basisStatus:
          pose.basis === null
            ? "native-missile-root-basis-unrecovered"
            : pose.basisStatus,
        rootInput: {
          entityId: row.trace.entityId,
          sourceEventId: row.trace.sourceEventId,
          familyPolicy: row.trace.policy,
          requestedTargetEntityId: row.trace.requestedTargetEntityId,
          positionStatus: pose.positionStatus,
          nativeAcceptance: null,
          ...(pose.effectBasisProgram
            ? { effectBasisProgram: structuredClone(pose.effectBasisProgram) }
            : {}),
        },
        nativeAcceptance: null,
        reasons: row.omissions.filter(
          (reason) =>
            !(
              pose.basis !== null &&
              reason === "world:missile-root-basis-unrecovered"
            ),
        ),
      };
    },
  });
}
