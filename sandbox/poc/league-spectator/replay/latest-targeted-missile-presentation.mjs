import { createLatestMissileTracking } from "./latest-missile-tracking.mjs";
import { stepPresentationMissileFrame } from "./latest-match-velocity-facing.mjs";
import { PRESENTATION_TARGET_POLICY } from "./latest-presentation-targets.mjs";
import {
  validateMissileEffectBasisProgram,
  zeroTurnMissileEffectBasis,
} from "./latest-missile-effect-basis.mjs";

export const TARGETED_MISSILE_PRESENTATION_POLICY =
  "native-rofl-retained-target-fixed-speed-partial-v2";
const f = Math.fround;
const finiteVector = (value) =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((lane) => Number.isFinite(lane) && Number.isFinite(f(lane)));
const order = (a, b) =>
  a.time - b.time ||
  a.transportSequence - b.transportSequence ||
  (a.entryOrder ?? 0) - (b.entryOrder ?? 0);
const cursor = (row) => ({
  transportSequence: row.transportSequence,
  entryOrder: row.entryOrder ?? 0,
});
const sourceId = (row) =>
  `packet:${row.transportSequence}:entry:${row.entryOrder ?? 0}:missile:${row.entityId}`;
const omissions = Object.freeze([
  "policy:declared-native-rofl-no-local-player-constructor-provider-view",
  "target:generated-presentation-handle-is-not-native-engine-acceptance",
  "target:unused-aim-offset-cache-isolated-from-position-and-motion",
  "target:linked-owner-provider-local-player-and-733-producers-unrecovered",
  "clock:supplied-60hz-replay-clock-not-original-recorded-frame-schedule",
  "collision:original-hit-and-world-collision-dispatch-unimplemented",
  "presentation:downstream-original-cast-and-child-spawn-unimplemented",
  "presentation:effect-resource-activation-and-rendering-not-in-this-trace",
  "presentation:stop-notification-and-particle-tails-unimplemented",
]);

// A separate diagnostic family. Legacy missile eligibility remains unchanged.
// Only decoded initial packets and shared static kernels are runtime inputs.
export function buildTargetedMissilePresentation({
  analysis,
  world,
  frame,
  motion,
  actors,
  endTime,
}) {
  if (
    analysis.build !== "16.21.829.8620" ||
    analysis.protocol !== "20e09df23c66b85e" ||
    !Number.isFinite(endTime) ||
    endTime <= 0 ||
    typeof world?.presentationTarget !== "function" ||
    typeof motion?.fixedSpeedStep !== "function"
  )
    throw Error("Exact-build targeted presentation inputs required");
  const tracking = createLatestMissileTracking({
    build: analysis.build,
    protocol: analysis.protocol,
    targetQueryRva: 0x88b5e0,
    controllerQueryRva: 0x88b500,
    controllerFrameRva: 0x88b760,
  });
  const identities = new Map(
    analysis.eventIndex.identities.map((row) => [row.entityId, row]),
  );
  const traces = [],
    omitted = [];
  for (const record of analysis.records) {
    if (!Number.isFinite(record.time) || record.time < 0)
      throw Error("Finite targeted creation time required");
    // Prefixes are inclusive: a creation exactly at endTime has its initial
    // state only. Future creations are not queried, initialized or counted.
    if (record.time > endTime) continue;
    if (
      record.movementType !== "FixedSpeedMovement" ||
      record.settings?.mTracksTarget !== true ||
      record.cast?.targetCount !== 1
    )
      continue;
    const identity = identities.get(record.entityId),
      match = record.verticalFacingType === "VeritcalFacingMatchVelocity";
    const reasons = frame
      .eligibility(record)
      .reasons.filter(
        (reason) =>
          ![
            "target-tracking",
            "target-reference-list",
            ...(match ? ["vertical-facing"] : []),
          ].includes(reason),
      );
    reasons.push(...actors.settings(record.behaviorSpecs).reasons);
    if (record.namedCasterStartPresentation?.resolved === false)
      reasons.push(...record.namedCasterStartPresentation.reasons);
    if (!identity) throw Error("Targeted missile identity missing");
    const prefixReplications = identity.replications.filter(
        (row) => row.time <= endTime,
      ),
      prefixEvents = identity.events.filter((event) => event.time <= endTime);
    if (prefixReplications.length !== 1)
      reasons.push("replication:repeated-identity");
    if (record.stream !== 1)
      reasons.push("replication:initial-snapshot-restore-unimplemented");
    if (record.elapsedSeconds !== 0)
      reasons.push("clock:nonzero-replication-age");
    if (record.pendingChildren !== 0)
      reasons.push("lifecycle:initial-child-registration");
    if (record.replicationPhase !== 0)
      reasons.push("lifecycle:initial-phase-history");
    if (
      !Number.isSafeInteger(record.transportSequence) ||
      record.transportSequence < 0 ||
      !Number.isSafeInteger(record.entryOrder ?? 0) ||
      (record.entryOrder ?? 0) < 0
    )
      reasons.push("identity:missing-original-transport-ordinal");
    if (
      record.initialPresentationByte !== 0 ||
      prefixEvents.some((event) => event.opcode === 99 && event.value !== 0)
    )
      reasons.push("presentation:nondefault-state");
    if (
      !record.behaviorSpecs?.some(
        (component) =>
          component.__type === "DestroyOnMovementComplete" &&
          (component.mDelay ?? 0) === 0,
      )
    )
      reasons.push("lifecycle:nonterminal-movement-behavior");
    if (
      record.behaviorSpecs?.some(
        (component) =>
          !["CastOnMovementComplete", "DestroyOnMovementComplete"].includes(
            component.__type,
          ),
      )
    )
      reasons.push("lifecycle:unimplemented-required-behavior");
    if (record.targetBoneName !== "")
      reasons.push("target:bone-query-unimplemented-or-unknown");
    if (record.verticalFacingProperties?.length)
      reasons.push("motion:vertical-facing-properties");
    if (record.settings?.mUseHeightOffsetAtEnd !== false)
      reasons.push("target:height-offset-at-end-update");
    const requested = record.cast.requestedTargets;
    if (
      !Array.isArray(requested) ||
      requested.length !== 1 ||
      !Number.isInteger(requested[0].requestedEntityId) ||
      requested[0].requestedEntityId <= 0 ||
      requested[0].requestedEntityId > 0xffffffff
    )
      reasons.push("target:requested-identity-unavailable");
    if (
      prefixEvents.some(
        (event) =>
          !Number.isSafeInteger(event.transportSequence) ||
          event.transportSequence < 0 ||
          !Number.isSafeInteger(event.entryOrder ?? 0) ||
          (event.entryOrder ?? 0) < 0,
      )
    )
      reasons.push("identity:notification-transport-ordinal");
    const events = prefixEvents
      .filter((event) => order(event, record) > 0)
      .sort(order);
    const targetId = requested?.[0]?.requestedEntityId;
    let initial;
    if (!reasons.length) {
      initial = world.presentationTarget(targetId, record.time, cursor(record));
      if (
        initial.policy !== PRESENTATION_TARGET_POLICY ||
        !initial.resolved ||
        !initial.presentationEligible ||
        !finiteVector(initial.position)
      )
        reasons.push("target:initial-presentation-view-unresolved-or-rejected");
    }
    if (reasons.length) {
      omitted.push({
        entityId: record.entityId,
        sequence: record.sequence,
        sourceEventId: sourceId(record),
        packetInitializationStatus: record.packetInitialization?.status ?? null,
        reasons: [...new Set(reasons)],
      });
      continue;
    }
    const instanceId = `presentation-missile:${record.entityId}:${record.transportSequence}:${record.entryOrder ?? 0}`;
    const sourceEventId = sourceId(record);
    const notificationId = (row) =>
      `${instanceId}:packet:${row.transportSequence}:entry:${row.entryOrder ?? 0}:opcode:${row.opcode}`;
    const targetView = (view) => ({
      kind: "supplied-ai-query-view",
      internalId: view.presentationTargetId,
      position: view.position,
      visible: view.visible,
      radius: view.radius,
      // This cache is copied by the native query but is not consumed by the
      // admitted fixed-speed/arrival/height/facing kernels. No actual aim offset
      // is inferred; its unavailable presentation consumers remain omissions.
      aimOffset: [0, 0, 0],
    });
    const retained = tracking.initialize({
      tracksTarget: true,
      tracksHidden: record.settings.mVisualsTrackHiddenTargets,
      acceptedInternalId: initial.presentationTargetId,
      endpoint: record.packetInitialization.targetPosition,
      heightAugment: record.packetInitialization.targetHeightAugment,
      boneHash: 0,
      target: targetView(initial),
      modeValue: 3,
    });
    const packet = record.packetInitialization;
    // Original 87f48e..87f4cd initializes actor velocity from the retained
    // constructor target before creation presentation. This is not the next
    // movement sample; dt=0 runs the already verified 148ddc0 vector helper.
    const initialVelocity = motion.fixedSpeedStep(
      packet.currentPosition,
      retained.targetPosition,
      packet.movementSpeed,
      0,
    ).velocity;
    const controller = {
      position: packet.currentPosition.map(f),
      initialPosition: packet.initialPosition.map(f),
      targetPosition: [...retained.targetPosition],
      speed: f(packet.movementSpeed),
      velocity: [...initialVelocity],
      cachedVelocity: [0, 0, 0],
      radius: retained.radius,
      canPassOnce: false,
      arrived: false,
      createdAt: f(record.time),
      startDelay: 0,
      heightController: record.heightController,
      verticalFacingType: record.verticalFacingType,
      history: [],
    };
    const actor = actors.initialize(record, initialVelocity, {
      instanceId,
      sourceEventId,
    });
    const states = [],
      querySources = new Set([
        ...initial.sourceEventIds,
        ...initial.visibilitySourceEventIds,
      ]),
      targetAssumptions = [...initial.assumptions];
    let local = 0,
      tick = 1,
      eventIndex = 0,
      stopTime = null,
      failed = null;
    const effectBasisProgram =
      record.effectBasisProgram && initialVelocity.some((lane) => f(lane) !== 0)
        ? validateMissileEffectBasisProgram(record.effectBasisProgram, {
            spellHash: record.cast.spellHash,
            spellName: record.definitionName,
            movementType: "FixedSpeedMovement",
          })
        : null;
    let effectBasis = null;
    const save = (notification = null) => {
      if (states.length >= 16000)
        throw Error("Targeted presentation exceeded bounded diagnostic window");
      if (effectBasisProgram && !actor.stopped)
        effectBasis = zeroTurnMissileEffectBasis(actor.velocity).basis;
      states.push({
        time: record.time + local,
        position: [...controller.position],
        velocity: [...actor.velocity],
        targetPosition: [...controller.targetPosition],
        stopped: actor.stopped,
        ...(effectBasisProgram ? { effectBasis: [...effectBasis] } : {}),
        phase: actor.phase,
        sampleStage: notification
          ? "after-notification"
          : "before-notifications",
        ...(notification
          ? {
              notificationSourceEventId: notificationId(notification),
              notificationOriginalEventId: notification.id ?? null,
              notificationTransportSequence: notification.transportSequence,
              notificationEntryOrder: notification.entryOrder ?? 0,
            }
          : {}),
      });
    };
    save();
    while (record.time + local < endTime) {
      const event = events[eventIndex],
        next = Math.min(
          endTime - record.time,
          tick / 60,
          event ? event.time - record.time : Infinity,
        );
      if (next < local)
        throw Error("Targeted presentation clock moved backwards");
      if (!actor.stopped && next > local) {
        const now = record.time + next,
          view = world.presentationTarget(
            targetId,
            now,
            event && event.time === now ? cursor(event) : null,
          );
        if (
          !view.resolved ||
          !finiteVector(view.position) ||
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
          querySources.add(id);
        // Initial acceptance is not re-run on retained references. Later bit17
        // rejection therefore does not silently retarget/drop a native holder.
        tracking.update(retained, targetView(view), 3);
        controller.targetPosition = [...retained.targetPosition];
        controller.radius = retained.radius;
        const update = stepPresentationMissileFrame(
          frame,
          controller,
          f(now),
          f(next - local),
          f(1 / 60),
        );
        actor.velocity = [...update.appliedVelocity];
        actors.afterMovement(actor, update.arrived, now);
        controller.velocity = [...actor.velocity];
      }
      local = next;
      save();
      while (
        eventIndex < events.length &&
        events[eventIndex].time <= record.time + local
      ) {
        const notification = events[eventIndex++];
        if (notification.opcode === 56)
          actors.phaseNotification(
            actor,
            notification.target,
            notification.time,
            {
              kind: "decoded-phase-notification",
              id: notificationId(notification),
              originalEventId: notification.id ?? null,
              transportSequence: notification.transportSequence,
              entryOrder: notification.entryOrder ?? 0,
            },
          );
        else if (notification.opcode === 497) actors.stop(actor);
        else if (notification.opcode !== 99)
          throw Error("Unknown targeted presentation notification");
        controller.velocity = [...actor.velocity];
        save(notification);
      }
      if (actor.stopped && stopTime === null) stopTime = record.time + local;
      if (actor.stopped && eventIndex === events.length) break;
      while (tick / 60 <= local + 1e-12) tick++;
      if (states.length > 16000)
        throw Error("Targeted presentation exceeded bounded diagnostic window");
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
      policy: TARGETED_MISSILE_PRESENTATION_POLICY,
      instanceId,
      sourceEventId,
      entityId: record.entityId,
      ownerId: record.cast.ownerId,
      ownerCharacter: record.ownerCharacter,
      definitionName: record.definitionName,
      spellHash: record.cast.spellHash,
      sequence: record.sequence,
      startTime: record.time,
      stopTime,
      requestedTargetEntityId: targetId,
      presentationHandle: initial.presentationHandle,
      presentationTargetId: initial.presentationTargetId,
      nativeAcceptedInternalId: null,
      nativeAcceptance: null,
      ...(effectBasisProgram ? { effectBasisProgram } : {}),
      ...(record.namedCasterStartPresentation
        ? { sourceStart: structuredClone(record.namedCasterStartPresentation) }
        : {}),
      states,
      emittedCastRequests: actor.castRequests,
      targetSourceEventIds: [...querySources],
      assumptions: targetAssumptions,
      omissions: [
        ...omissions,
        ...initial.omissions,
        ...(record.namedCasterStartPresentation?.omissions ?? []),
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
    build: analysis.build,
    protocol: analysis.protocol,
    endTime,
    policy: TARGETED_MISSILE_PRESENTATION_POLICY,
    traces,
    omitted,
    summary: {
      traces: traces.length,
      omitted: omitted.length,
      reasons,
      emittedCastRequests: traces.reduce(
        (sum, trace) => sum + trace.emittedCastRequests.length,
        0,
      ),
      rendered: 0,
      nativeAccepted: null,
      complete: null,
    },
    omissions: [...omissions],
  };
}
