import { createLatestMissileTracking } from "./latest-missile-tracking.mjs";
import { PRESENTATION_TARGET_POLICY } from "./latest-presentation-targets.mjs";
import { requireEmptyCastIndexedOverrides } from "./latest-cast-indexed-overrides.mjs";
import {
  validateMissileEffectBasisProgram,
  zeroTurnMissileEffectBasis,
} from "./latest-missile-effect-basis.mjs";
export const FIXED_TIME_PRESENTATION_POLICY =
  "native-rofl-retained-target-fixed-time-partial-v1";
const f = Math.fround;
const vector = (v) =>
  Array.isArray(v) &&
  v.length === 3 &&
  v.every((n) => Number.isFinite(n) && Number.isFinite(f(n)));
const ordinal = (n) => Number.isSafeInteger(n) && n >= 0;
const order = (a, b) =>
  a.time - b.time ||
  a.transportSequence - b.transportSequence ||
  (a.entryOrder ?? 0) - (b.entryOrder ?? 0);
const cursor = (r) => ({
  transportSequence: r.transportSequence,
  entryOrder: r.entryOrder ?? 0,
});
const omissions = [
  "policy:declared-native-rofl-no-local-player-constructor-provider-view",
  "target:generated-presentation-handle-is-not-native-engine-acceptance",
  "target:unused-aim-offset-cache-isolated-from-position-and-motion",
  "clock:supplied-60hz-replay-clock-not-original-recorded-frame-schedule",
  "collision:original-hit-and-world-collision-dispatch-unimplemented",
  "presentation:downstream-original-cast-and-child-spawn-unimplemented",
  "presentation:effect-resource-activation-and-rendering-not-in-this-trace",
  "presentation:stop-notification-and-particle-tails-unimplemented",
];

// A strict new family; FixedSpeed and legacy admission remain independent.
export function buildFixedTimePresentation({
  records,
  eventIndex,
  world,
  actors,
  kernel,
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
    throw Error("Exact-build FixedTime presentation inputs required");
  const tracking = createLatestMissileTracking({
    build,
    protocol,
    targetQueryRva: 0x88b5e0,
    controllerQueryRva: 0x88b500,
    controllerFrameRva: 0x88b760,
  });
  const identities = new Map(eventIndex.identities.map((r) => [r.entityId, r])),
    traces = [],
    omitted = [];
  for (const record of records) {
    if (!Number.isFinite(record.time) || record.time < 0)
      throw Error("Finite FixedTime creation time required");
    if (record.time > endTime) continue;
    const sourceEventId = `packet:${record.transportSequence}:entry:${record.entryOrder ?? 0}:missile:${record.entityId}`,
      instanceId = `presentation-missile:${record.entityId}:${record.transportSequence}:${record.entryOrder ?? 0}`;
    const identity = identities.get(record.entityId);
    if (!identity) throw Error("FixedTime presentation identity missing");
    const prefixReplications = identity.replications.filter(
        (row) => row.time <= endTime,
      ),
      prefixEvents = identity.events.filter((row) => row.time <= endTime);
    const reasons = [...actors.settings(record.behaviorSpecs).reasons];
    if (record.movementType !== "FixedTimeMovement")
      reasons.push("movement:fixed-time-type-required");
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
    if (record.packetInitialization?.status !== "initialized-position-fields")
      reasons.push(
        `packet:${record.packetInitialization?.status ?? "initialization-unavailable"}`,
      );
    if (
      !vector(record.startInitialization?.position) ||
      !vector(record.packetInitialization?.currentPosition) ||
      !vector(record.packetInitialization?.initialPosition) ||
      record.startInitialization.position.some(
        (lane, index) =>
          f(lane) !== f(record.packetInitialization.currentPosition[index]) ||
          f(lane) !== f(record.packetInitialization.initialPosition[index]),
      )
    )
      reasons.push("motion:prepacket-constructor-origin-equivalence-unproven");
    if (
      !Number.isFinite(record.packetInitialization?.targetHeightAugment) ||
      f(record.packetInitialization.targetHeightAugment) !==
        f(record.settings?.mTargetHeightAugment)
    )
      reasons.push("target:prepacket-query-height-equivalence-unproven");
    if (
      record.controllerScalarB0 !== f(3.4028234663852886e38) ||
      record.controllerScalarB4 !== 0
    )
      reasons.push("motion:pending-packet-correction");
    if (record.settings?.mStartDelay !== 0)
      reasons.push("clock:start-delay-binding");
    if (!(record.settings?.mTravelTime >= 0))
      reasons.push("clock:unverified-negative-travel-time");
    if (record.uninterpretedMovementFields?.length)
      reasons.push(
        `movement:properties:${record.uninterpretedMovementFields.join(",")}`,
      );
    if (
      record.settings?.mTracksTarget !== true ||
      record.cast.targetCount !== 1
    )
      reasons.push("target:tracked-single-reference-family-required");
    if (record.settings?.mUseHeightOffsetAtEnd !== false)
      reasons.push("target:height-offset-at-end-update");
    if (record.cast.overrideFlag14d !== 0)
      reasons.push("target:initial-actor-velocity-before-height-override");
    if (
      !Number.isInteger(record.cast.indexedOverrideCount) ||
      record.cast.indexedOverrideCount < 0 ||
      record.cast.indexedOverrideCount > 0xffffffff
    )
      reasons.push("cast:indexed-override-count-unavailable");
    else if (!requireEmptyCastIndexedOverrides(record.cast).resolved)
      reasons.push("cast:nonempty-indexed-overrides-untranslated");
    if (record.targetBoneName !== "")
      reasons.push("target:bone-query-unimplemented-or-unknown");
    if (
      record.verticalFacingType !== "VeritcalFacingMatchVelocity" ||
      record.verticalFacingProperties.length
    )
      reasons.push("motion:vertical-facing-type-or-properties");
    if (!record.heightController?.resolved)
      reasons.push(
        record.heightController?.reason ?? "height:default-gravity-unavailable",
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
    const requested = record.cast.requestedTargets;
    if (
      !Array.isArray(requested) ||
      requested.length !== 1 ||
      !Number.isInteger(requested[0].requestedEntityId) ||
      requested[0].requestedEntityId <= 0 ||
      requested[0].requestedEntityId > 0xffffffff
    )
      reasons.push("target:requested-identity-unavailable");
    let initial;
    const targetId = requested?.[0]?.requestedEntityId;
    if (!reasons.length) {
      initial = world.presentationTarget(targetId, record.time, cursor(record));
      if (
        initial.policy !== PRESENTATION_TARGET_POLICY ||
        !initial.resolved ||
        !initial.presentationEligible ||
        !vector(initial.position)
      )
        reasons.push("target:initial-presentation-view-unresolved-or-rejected");
    }
    if (reasons.length) {
      omitted.push({
        entityId: record.entityId,
        sequence: record.sequence,
        sourceEventId,
        reasons: [...new Set(reasons)],
        inputStatus: {
          packet: record.packetInitialization?.status,
          start: record.startInitialization?.status,
          target: record.targetInitialization?.status,
        },
      });
      continue;
    }
    const targetView = (view) => ({
      kind: "supplied-ai-query-view",
      internalId: view.presentationTargetId,
      position: view.position,
      visible: view.visible,
      radius: view.radius,
      aimOffset: [0, 0, 0],
    });
    const packet = record.packetInitialization,
      retained = tracking.initialize({
        tracksTarget: true,
        tracksHidden: record.settings.mVisualsTrackHiddenTargets,
        acceptedInternalId: initial.presentationTargetId,
        endpoint: packet.targetPosition,
        heightAugment: packet.targetHeightAugment,
        boneHash: 0,
        target: targetView(initial),
        modeValue: 3,
      });
    const state = kernel.initialize({
      position: packet.currentPosition,
      targetPosition: retained.targetPosition,
      travelTime: record.settings.mTravelTime,
      startDelay: 0,
      createdAt: record.time,
      travelTimeOverride: null,
      gravity: record.heightController.gravity,
    });
    state.initialPosition = packet.initialPosition.map(f);
    state.speed = f(packet.movementSpeed);
    const actor = actors.initialize(record, state.velocity, {
        instanceId,
        sourceEventId,
      }),
      events = prefixEvents.filter((row) => order(row, record) > 0).sort(order),
      states = [],
      targetSources = new Set([
        ...initial.sourceEventIds,
        ...initial.visibilitySourceEventIds,
      ]);
    const effectBasisProgram =
      record.effectBasisProgram && state.velocity.some((lane) => f(lane) !== 0)
        ? validateMissileEffectBasisProgram(record.effectBasisProgram, {
            spellHash: record.cast.spellHash,
            spellName: record.definitionName,
          })
        : null;
    let effectBasis = null;
    let local = 0,
      tick = 1,
      eventAt = 0,
      stopTime = null,
      failed = null;
    const notificationId = (row) =>
      `${instanceId}:packet:${row.transportSequence}:entry:${row.entryOrder ?? 0}:opcode:${row.opcode}`;
    const save = (event = null) => {
      if (states.length >= 16000)
        throw Error("FixedTime diagnostic clock exceeds bounded window");
      if (effectBasisProgram && !actor.stopped)
        effectBasis = zeroTurnMissileEffectBasis(actor.velocity).basis;
      states.push({
        time: record.time + local,
        position: [...state.position],
        velocity: [...actor.velocity],
        targetPosition: [...state.targetPosition],
        phase: actor.phase,
        stopped: actor.stopped,
        ...(effectBasisProgram ? { effectBasis: [...effectBasis] } : {}),
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
      const event = events[eventAt],
        next = Math.min(
          endTime - record.time,
          tick / 60,
          event ? event.time - record.time : Infinity,
        );
      if (next < local)
        throw Error("FixedTime presentation clock moved backwards");
      if (!actor.stopped && next > local) {
        const now = record.time + next,
          view = world.presentationTarget(
            targetId,
            now,
            event && event.time === now ? cursor(event) : null,
          );
        if (
          !view.resolved ||
          !vector(view.position) ||
          view.presentationHandle !== initial.presentationHandle ||
          view.presentationTargetId !== initial.presentationTargetId
        ) {
          failed = {
            reason: "target:retained-generation-or-actual-pose-unresolved",
            time: now,
            queryReasons: view.reasons,
          };
          break;
        }
        for (const id of [
          ...view.sourceEventIds,
          ...view.visibilitySourceEventIds,
        ])
          targetSources.add(id);
        tracking.update(retained, targetView(view), 3);
        state.targetPosition = [...retained.targetPosition];
        const update = kernel.step(state, f(now), f(next - local), f(1 / 60));
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
          throw Error("Unknown FixedTime presentation notification");
        state.velocity = [...actor.velocity];
        save(row);
      }
      if (actor.stopped && stopTime === null) stopTime = record.time + local;
      if (actor.stopped && eventAt === events.length) break;
      while (tick / 60 <= local + 1e-12) tick++;
    }
    if (failed) {
      omitted.push({
        entityId: record.entityId,
        sequence: record.sequence,
        sourceEventId,
        reasons: [failed.reason],
        failedQuery: failed,
      });
      continue;
    }
    traces.push({
      policy: FIXED_TIME_PRESENTATION_POLICY,
      instanceId,
      sourceEventId,
      entityId: record.entityId,
      ownerId: record.cast.ownerId,
      ownerCharacter: record.ownerCharacter,
      definitionName: record.definitionName,
      ...(effectBasisProgram ? { effectBasisProgram } : {}),
      spellHash: record.cast.spellHash,
      sequence: record.sequence,
      startTime: record.time,
      stopTime,
      requestedTargetEntityId: targetId,
      presentationHandle: initial.presentationHandle,
      presentationTargetId: initial.presentationTargetId,
      nativeAcceptedInternalId: null,
      nativeAcceptance: null,
      states,
      emittedCastRequests: actor.castRequests,
      targetSourceEventIds: [...targetSources],
      assumptions: [...initial.assumptions],
      omissions: [...omissions, ...initial.omissions],
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
    policy: FIXED_TIME_PRESENTATION_POLICY,
    traces,
    omitted,
    summary: {
      traces: traces.length,
      omitted: omitted.length,
      reasons,
      emittedCastRequests: traces.reduce(
        (sum, row) => sum + row.emittedCastRequests.length,
        0,
      ),
      rendered: 0,
      nativeAccepted: null,
      complete: null,
    },
    omissions: [...omissions],
  };
}
