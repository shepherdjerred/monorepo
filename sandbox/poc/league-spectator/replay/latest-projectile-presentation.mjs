import { TARGETED_MISSILE_PRESENTATION_POLICY } from "./latest-targeted-missile-presentation.mjs";
import { FIXED_TIME_PRESENTATION_POLICY } from "./latest-fixed-time-presentation.mjs";
import { ZERO_REFERENCE_FIXED_TIME_PRESENTATION_POLICY } from "./latest-zero-reference-fixed-time.mjs";
import {
  MISSILE_PRESENTATION_FAMILIES_POLICY,
  VERIFIED_MISSILE_PRESENTATION_FAMILIES,
} from "./latest-missile-presentation-families.mjs";
import { sampleLatestMissileTrace } from "./latest-missile-playback.mjs";
import {
  validateMissileEffectBasisStates,
  MISSILE_EFFECT_BASIS_POLICY,
} from "./latest-missile-effect-basis.mjs";
const vector = (value) =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every(
    (lane) => Number.isFinite(lane) && Number.isFinite(Math.fround(lane)),
  );
const ordinal = (value) => Number.isSafeInteger(value) && value >= 0;
const before = (row, time, cursor) =>
  row.time !== time || !cursor
    ? row.time <= time
    : cursor.exclusive
      ? row.transportSequence < cursor.transportSequence ||
        (row.transportSequence === cursor.transportSequence &&
          (row.entryOrder ?? 0) < cursor.entryOrder)
      : row.transportSequence < cursor.transportSequence ||
        (row.transportSequence === cursor.transportSequence &&
          (row.entryOrder ?? 0) <= cursor.entryOrder);

// Serializable generated presentation identities. Native engine registration,
// root basis, bone providers and final retirement remain explicit dependencies.
export function createProjectilePresentation(report, presentation = null) {
  const traces = new Map(),
    records = new Map();
  if (presentation !== null) {
    const combined =
      presentation.policy === MISSILE_PRESENTATION_FAMILIES_POLICY;
    const familyPolicies = combined
      ? presentation.familyPolicies
      : [presentation.policy];
    if (
      (!combined &&
        ![
          TARGETED_MISSILE_PRESENTATION_POLICY,
          FIXED_TIME_PRESENTATION_POLICY,
          ZERO_REFERENCE_FIXED_TIME_PRESENTATION_POLICY,
        ].includes(presentation.policy)) ||
      (combined &&
        (!Array.isArray(presentation.familyPolicies) ||
          presentation.familyPolicies.length < 2 ||
          presentation.familyPolicies.length >
            VERIFIED_MISSILE_PRESENTATION_FAMILIES.length ||
          presentation.familyPolicies.some(
            (policy, index) =>
              policy !== VERIFIED_MISSILE_PRESENTATION_FAMILIES[index],
          ))) ||
      presentation.build !== report.build ||
      presentation.protocol !== report.protocol ||
      !Number.isFinite(presentation.endTime) ||
      presentation.endTime <= 0 ||
      (Number.isFinite(report.endTime) &&
        presentation.endTime > report.endTime) ||
      !Array.isArray(presentation.traces) ||
      presentation.replaySha256 !== report.replaySha256
    )
      throw Error(
        "Matching generated projectile presentation contract required",
      );
    for (const trace of presentation.traces) {
      const matches = report.missiles.filter(
        (record) =>
          record.entityId === trace.entityId &&
          record.sequence === trace.sequence,
      );
      const record = matches[0];
      const zeroReference =
        trace.policy === ZERO_REFERENCE_FIXED_TIME_PRESENTATION_POLICY;
      if (
        matches.length !== 1 ||
        !ordinal(record.transportSequence) ||
        !ordinal(record.entryOrder ?? 0) ||
        !familyPolicies.includes(trace.policy) ||
        trace.startTime !== record.time ||
        trace.startTime > presentation.endTime ||
        trace.nativeAcceptance !== null ||
        trace.nativeAcceptedInternalId !== null ||
        trace.rendered !== false ||
        trace.complete !== null ||
        trace.instanceId !==
          `presentation-missile:${record.entityId}:${record.transportSequence}:${record.entryOrder ?? 0}` ||
        trace.sourceEventId !==
          `packet:${record.transportSequence}:entry:${record.entryOrder ?? 0}:missile:${record.entityId}` ||
        trace.ownerId !== record.cast?.ownerId ||
        (zeroReference
          ? trace.requestedTargetEntityId !== null ||
            record.cast?.targetCount !== 0 ||
            !Array.isArray(record.cast.requestedTargets) ||
            record.cast.requestedTargets.length !== 0 ||
            trace.selectedInternalId !== 0 ||
            trace.holderPresent !== false ||
            trace.authoredTracksTarget !== true ||
            trace.presentationHandle !== null ||
            trace.presentationTargetId !== null
          : trace.requestedTargetEntityId !==
            record.cast?.requestedTargets?.[0]?.requestedEntityId) ||
        !Array.isArray(trace.omissions) ||
        !Array.isArray(trace.states) ||
        !trace.states.length ||
        trace.states.length > 16000 ||
        trace.states[0].time !== trace.startTime ||
        traces.has(trace.entityId)
      )
        throw Error("Causal generated projectile identity required");
      let previous = trace.startTime;
      for (const state of trace.states) {
        if (
          !Number.isFinite(state.time) ||
          state.time < previous ||
          state.time > presentation.endTime ||
          !vector(state.position) ||
          !vector(state.velocity) ||
          (state.targetPosition !== undefined &&
            !vector(state.targetPosition)) ||
          typeof state.stopped !== "boolean" ||
          (state.notificationSourceEventId &&
            (!ordinal(state.notificationTransportSequence) ||
              !ordinal(state.notificationEntryOrder)))
        )
          throw Error("Ordered finite projectile presentation states required");
        previous = state.time;
      }
      if (trace.effectBasisProgram !== undefined) {
        const movementType =
          trace.policy === TARGETED_MISSILE_PRESENTATION_POLICY
            ? "FixedSpeedMovement"
            : "FixedTimeMovement";
        if (
          ![
            TARGETED_MISSILE_PRESENTATION_POLICY,
            FIXED_TIME_PRESENTATION_POLICY,
            ZERO_REFERENCE_FIXED_TIME_PRESENTATION_POLICY,
          ].includes(trace.policy)
        )
          throw Error(
            "Missile basis is admitted only for a verified movement family",
          );
        validateMissileEffectBasisStates(
          trace.effectBasisProgram,
          trace.states,
          {
            spellHash: record.cast.spellHash,
            spellName: trace.definitionName,
            movementType,
          },
        );
      } else if (trace.states.some((state) => state.effectBasis !== undefined))
        throw Error("Missile effect basis requires its source program");
      traces.set(trace.entityId, structuredClone(trace));
      records.set(trace.entityId, {
        time: record.time,
        transportSequence: record.transportSequence,
        entryOrder: record.entryOrder ?? 0,
      });
    }
  }
  const query = (entityId, time, cursor = null) => {
    if (
      !Number.isInteger(entityId) ||
      !Number.isFinite(time) ||
      (cursor !== null &&
        (!ordinal(cursor.transportSequence) ||
          !ordinal(cursor.entryOrder) ||
          (cursor.exclusive !== undefined &&
            typeof cursor.exclusive !== "boolean")))
    )
      throw Error("Causal projectile presentation query required");
    const trace = traces.get(entityId),
      record = records.get(entityId);
    if (!trace || time > presentation.endTime || !before(record, time, cursor))
      return null;
    const states = cursor
      ? trace.states.filter(
          (state) =>
            state.time !== time ||
            !state.notificationSourceEventId ||
            before(
              {
                time: state.time,
                transportSequence: state.notificationTransportSequence,
                entryOrder: state.notificationEntryOrder,
              },
              time,
              cursor,
            ),
        )
      : trace.states;
    const sampled = structuredClone(
      sampleLatestMissileTrace({ ...trace, states }, time),
    );
    return {
      ...sampled,
      policy: presentation.policy,
      familyPolicy: trace.policy,
      instanceId: trace.instanceId,
      entityId,
      sourceId: trace.ownerId,
      targetId: trace.requestedTargetEntityId,
      sourceEventId: trace.sourceEventId,
      presentationHandle: trace.instanceId,
      positionStatus:
        "verified-kernels-under-declared-target-and-clock-presentation-policy",
      basis: trace.effectBasisProgram ? [...sampled.effectBasis] : null,
      basisStatus: trace.effectBasisProgram
        ? MISSILE_EFFECT_BASIS_POLICY
        : "missile-root-basis-unimplemented",
      ...(trace.effectBasisProgram
        ? { effectBasisProgram: structuredClone(trace.effectBasisProgram) }
        : {}),
      lifecycle: sampled.stopped
        ? "stopped-retirement-unresolved"
        : "moving-retirement-unresolved",
      nativeAcceptance: null,
      nativeAcceptedInternalId: null,
      omissions: [
        ...trace.omissions,
        ...(trace.effectBasisProgram
          ? []
          : ["world:missile-root-basis-unimplemented"]),
        "world:missile-registration-retirement-unimplemented",
      ],
      complete: null,
    };
  };
  return Object.freeze({
    query,
    identities: [...traces].map(([entityId, trace]) => ({
      entityId,
      creationTime: trace.startTime,
      creationTransportSequence: records.get(entityId).transportSequence,
      creationEntryOrder: records.get(entityId).entryOrder ?? 0,
      position: [...trace.states[0].position],
      entityClass: "projectile",
      sourceEventId: trace.sourceEventId,
    })),
  });
}
