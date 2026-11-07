import {
  ZERO_REFERENCE_FIXED_TIME_POLICY,
  ZERO_REFERENCE_FIXED_TIME_PRESENTATION_POLICY,
} from "./latest-zero-reference-fixed-time.mjs";
import { EMPTY_BONE_CASTER_START_POLICY } from "./latest-missile-caster-start.mjs";
import { requireEmptyCastIndexedOverrides } from "./latest-cast-indexed-overrides.mjs";
import {
  validateMissileEffectBasisProgram,
  zeroTurnMissileEffectBasis,
} from "./latest-missile-effect-basis.mjs";

export { ZERO_REFERENCE_FIXED_TIME_PRESENTATION_POLICY } from "./latest-zero-reference-fixed-time.mjs";
const f = Math.fround;
const ordinal = (v) => Number.isSafeInteger(v) && v >= 0;
const vector = (v) =>
  Array.isArray(v) &&
  v.length === 3 &&
  v.every((n) => Number.isFinite(n) && Number.isFinite(f(n)));
const order = (a, b) =>
  a.time - b.time ||
  a.transportSequence - b.transportSequence ||
  (a.entryOrder ?? 0) - (b.entryOrder ?? 0);
const omissions = [
  "world:source-root-is-shared-replay-view-not-recovered-native-match-state",
  "clock:supplied-60hz-replay-clock-not-original-recorded-frame-schedule",
  "collision:original-hit-and-world-collision-dispatch-unimplemented",
  "presentation:downstream-original-cast-and-child-spawn-unimplemented",
  "presentation:effect-resource-activation-and-rendering-not-in-this-trace",
  "presentation:stop-notification-and-particle-tails-unimplemented",
];

// An empty original CastInfo selector is a distinct family, not a synthetic
// target or a waiver of the retained-target family's identity requirements.
export function buildZeroReferenceFixedTimePresentation({
  records,
  eventIndex,
  actors,
  controller,
  build,
  protocol,
  endTime,
}) {
  if (
    build !== "16.21.829.8620" ||
    protocol !== "20e09df23c66b85e" ||
    !Number.isFinite(endTime) ||
    endTime <= 0
  )
    throw Error("Exact-build zero-reference FixedTime inputs required");
  const identities = new Map(eventIndex.identities.map((r) => [r.entityId, r]));
  const traces = [],
    omitted = [];
  for (const record of records) {
    if (!Number.isFinite(record.time) || record.time < 0)
      throw Error("Finite zero-reference creation time required");
    if (record.time > endTime) continue;
    const sourceEventId = `packet:${record.transportSequence}:entry:${record.entryOrder ?? 0}:missile:${record.entityId}`;
    const instanceId = `presentation-missile:${record.entityId}:${record.transportSequence}:${record.entryOrder ?? 0}`;
    const identity = identities.get(record.entityId);
    if (!identity) throw Error("Zero-reference missile identity missing");
    const prefixReplications = identity.replications.filter(
      (r) => r.time <= endTime,
    );
    const prefixEvents = identity.events.filter((r) => r.time <= endTime);
    const reasons = [...actors.settings(record.behaviorSpecs).reasons];
    const spec = record.zeroReferenceSpec;
    if (
      record.movementType !== "FixedTimeMovement" ||
      spec?.policy !== ZERO_REFERENCE_FIXED_TIME_POLICY ||
      !spec.resolved ||
      spec.selectedInternalId !== 0 ||
      spec.holderPresent !== false ||
      spec.settings?.mTracksTarget !== true ||
      spec.settings.mUseGroundHeightAtTarget !== true
    )
      reasons.push("movement:resolved-original-zero-reference-spec-required");
    if (spec?.resolved === false && Array.isArray(spec.reasons))
      reasons.push(...spec.reasons);
    if (record.stream !== 1)
      reasons.push("replication:initial-snapshot-restore-unimplemented");
    if (prefixReplications.length !== 1)
      reasons.push("replication:repeated-identity");
    if (record.elapsedSeconds !== 0)
      reasons.push("clock:nonzero-replication-age");
    if (record.pendingChildren !== 0)
      reasons.push("lifecycle:initial-child-registration");
    if (record.replicationPhase !== 0)
      reasons.push("lifecycle:initial-phase-history");
    if (
      !ordinal(record.transportSequence) ||
      !ordinal(record.entryOrder ?? 0) ||
      prefixEvents.some(
        (r) => !ordinal(r.transportSequence) || !ordinal(r.entryOrder ?? 0),
      )
    )
      reasons.push("identity:missing-original-transport-ordinal");
    if (
      record.initialPresentationByte !== 0 ||
      prefixEvents.some((r) => r.opcode === 99 && r.value !== 0)
    )
      reasons.push("presentation:nondefault-state");
    if (
      record.controllerScalarB0 !== f(3.4028234663852886e38) ||
      record.controllerScalarB4 !== 0
    )
      reasons.push("motion:pending-packet-correction");
    if (
      record.cast.targetCount !== 0 ||
      !Array.isArray(record.cast.requestedTargets) ||
      record.cast.requestedTargets.length
    )
      reasons.push("target:original-empty-reference-required");
    if (
      record.cast.overrideFlag14d !== 0 ||
      !requireEmptyCastIndexedOverrides(record.cast).resolved
    )
      reasons.push("cast:nonempty-overrides-untranslated");
    if (
      record.startInitialization?.policy !== EMPTY_BONE_CASTER_START_POLICY ||
      !record.startInitialization.resolved ||
      record.startInitialization.status !== "initialized" ||
      !vector(record.startInitialization.position) ||
      record.startInitialization.attachmentHeightOffset !== 0
    )
      reasons.push("start:owned-empty-bone-caster-root-required");
    if (record.targetInitialization?.status !== "initialized")
      reasons.push(
        `target:${record.targetInitialization?.status ?? "initialization-unavailable"}`,
      );
    if (record.packetInitialization?.status !== "initialized-position-fields")
      reasons.push(
        `packet:${record.packetInitialization?.status ?? "initialization-unavailable"}`,
      );
    if (
      !record.behaviorSpecs.some(
        (r) =>
          r.__type === "DestroyOnMovementComplete" && (r.mDelay ?? 0) === 0,
      ) ||
      record.behaviorSpecs.some(
        (r) =>
          !["DestroyOnMovementComplete", "CastOnMovementComplete"].includes(
            r.__type,
          ),
      )
    )
      reasons.push("lifecycle:unimplemented-required-behavior");
    if (reasons.length) {
      omitted.push({
        entityId: record.entityId,
        sequence: record.sequence,
        sourceEventId,
        reasons: [...new Set(reasons)],
      });
      continue;
    }
    const movement = controller.initialize({
      record,
      start: record.startInitialization,
      spec,
    });
    const state = movement.state;
    const actor = actors.initialize(record, state.velocity, {
      instanceId,
      sourceEventId,
    });
    const basisProgram =
      record.effectBasisProgram && state.velocity.some((v) => f(v) !== 0)
        ? validateMissileEffectBasisProgram(record.effectBasisProgram, {
            spellHash: record.cast.spellHash,
            spellName: record.definitionName,
          })
        : null;
    const events = prefixEvents.filter((r) => order(r, record) > 0).sort(order);
    const states = [];
    let local = 0,
      tick = 1,
      eventAt = 0,
      stopTime = null,
      basis = null;
    const notificationId = (r) =>
      `${instanceId}:packet:${r.transportSequence}:entry:${r.entryOrder ?? 0}:opcode:${r.opcode}`;
    const save = (event = null) => {
      if (states.length >= 16000)
        throw Error("Zero-reference diagnostic clock exceeds bounded window");
      if (basisProgram && !actor.stopped)
        basis = zeroTurnMissileEffectBasis(actor.velocity).basis;
      states.push({
        time: record.time + local,
        position: [...state.position],
        velocity: [...actor.velocity],
        targetPosition: [...state.targetPosition],
        phase: actor.phase,
        stopped: actor.stopped,
        ...(basisProgram ? { effectBasis: [...basis] } : {}),
        sampleStage: event ? "after-notification" : "before-notifications",
        ...(event
          ? {
              notificationSourceEventId: notificationId(event),
              notificationOriginalEventId: event.id ?? null,
              notificationTransportSequence: event.transportSequence,
              notificationEntryOrder: event.entryOrder ?? 0,
            }
          : {}),
      });
    };
    save();
    while (record.time + local < endTime) {
      const event = events[eventAt];
      const next = Math.min(
        endTime - record.time,
        tick / 60,
        event ? event.time - record.time : Infinity,
      );
      if (next < local)
        throw Error("Zero-reference presentation clock moved backwards");
      if (!actor.stopped && next > local) {
        const now = record.time + next;
        const update = controller.step(
          movement,
          f(now),
          f(next - local),
          f(1 / 60),
        );
        actor.velocity = [...update.appliedVelocity];
        actors.afterMovement(actor, update.arrived, now);
        state.velocity = [...actor.velocity];
      }
      local = next;
      save();
      while (
        eventAt < events.length &&
        events[eventAt].time <= record.time + local
      ) {
        const row = events[eventAt++];
        if (row.opcode === 56)
          actors.phaseNotification(actor, row.target, row.time, {
            kind: "decoded-phase-notification",
            id: notificationId(row),
            originalEventId: row.id ?? null,
            transportSequence: row.transportSequence,
            entryOrder: row.entryOrder ?? 0,
          });
        else if (row.opcode === 497) actors.stop(actor);
        else if (row.opcode !== 99)
          throw Error("Unknown zero-reference presentation notification");
        state.velocity = [...actor.velocity];
        save(row);
      }
      if (actor.stopped && stopTime === null) stopTime = record.time + local;
      if (actor.stopped && eventAt === events.length) break;
      while (tick / 60 <= local + 1e-12) tick++;
    }
    traces.push({
      policy: ZERO_REFERENCE_FIXED_TIME_PRESENTATION_POLICY,
      instanceId,
      sourceEventId,
      entityId: record.entityId,
      ownerId: record.cast.ownerId,
      ownerCharacter: record.ownerCharacter,
      definitionName: record.definitionName,
      ...(basisProgram ? { effectBasisProgram: basisProgram } : {}),
      spellHash: record.cast.spellHash,
      sequence: record.sequence,
      startTime: record.time,
      stopTime,
      requestedTargetEntityId: null,
      selectedInternalId: 0,
      holderPresent: false,
      authoredTracksTarget: true,
      presentationHandle: null,
      presentationTargetId: null,
      nativeAcceptedInternalId: null,
      nativeAcceptance: null,
      states,
      emittedCastRequests: actor.castRequests,
      targetSourceEventIds: [],
      sourceStart: structuredClone(record.startInitialization),
      assumptions: [],
      omissions: [
        ...omissions,
        ...(record.startInitialization.omissions ?? []),
      ],
      actualMatchMotionAccepted: false,
      rendered: false,
      complete: null,
    });
  }
  const reasons = {};
  for (const row of omitted)
    for (const reason of row.reasons)
      reasons[reason] = (reasons[reason] ?? 0) + 1;
  return {
    build,
    protocol,
    endTime,
    policy: ZERO_REFERENCE_FIXED_TIME_PRESENTATION_POLICY,
    traces,
    omitted,
    summary: {
      traces: traces.length,
      omitted: omitted.length,
      reasons,
      emittedCastRequests: traces.reduce(
        (n, r) => n + r.emittedCastRequests.length,
        0,
      ),
      rendered: 0,
      nativeAccepted: null,
      complete: null,
    },
    omissions: [...omissions],
  };
}
