// Original zero-reference FixedTime slice used by its explicit partial family:
// mTracksTarget remains authored true, while CastInfo's empty selector returns
// zero and the original factory creates no target holder. There is no target
// query/reacquisition and the terrain-derived endpoint remains retained.
import {
  compileFixedTimeSpec,
  compileDefaultGravitySolver,
} from "./latest-fixed-time-spec.mjs";
import { initializeLatestMissileTarget } from "./latest-missiles.mjs";
import { requireEmptyCastIndexedOverrides } from "./latest-cast-indexed-overrides.mjs";

const f = Math.fround;
export const ZERO_REFERENCE_FIXED_TIME_POLICY =
  "original-empty-reference-fixed-time-component-v1";
export const ZERO_REFERENCE_FIXED_TIME_PRESENTATION_POLICY =
  "native-rofl-zero-reference-fixed-time-partial-v1";

export function compileZeroReferenceFixedTimeSpec(spec, motionDefinition) {
  const compiled = compileFixedTimeSpec(
    spec.movementComponent,
    motionDefinition,
  );
  const height = compileDefaultGravitySolver(spec.heightSolver);
  const reasons = [];
  if (compiled.unknown.length) reasons.push("movement:unknown-properties");
  if (!compiled.settings.mTracksTarget)
    reasons.push("target:authored-tracking-required");
  if (compiled.settings.mProjectTargetToCastRange)
    reasons.push("target:cast-range-projection");
  if (compiled.settings.mUseHeightOffsetAtEnd)
    reasons.push("target:height-offset-at-end");
  if (compiled.settings.mUseGroundHeightAtTarget !== true)
    reasons.push("target:original-terrain-endpoint-required");
  if (compiled.settings.mStartDelay !== 0) reasons.push("clock:start-delay");
  if (compiled.settings.mTravelTime < 0)
    reasons.push("clock:negative-travel-time");
  if (
    compiled.strings.mStartBoneName !== "" ||
    compiled.strings.mTargetBoneName !== ""
  )
    reasons.push("attachment:nonempty-bone");
  if (!height.resolved) reasons.push(height.reason);
  if (
    spec.verticalFacing?.__type !== "VeritcalFacingMatchVelocity" ||
    Object.keys(spec.verticalFacing).some((key) => key !== "__type")
  )
    reasons.push("facing:unsupported");
  return {
    policy: ZERO_REFERENCE_FIXED_TIME_POLICY,
    resolved: reasons.length === 0,
    reasons,
    settings: compiled.settings,
    gravity: height.resolved ? height.gravity : null,
    nativeDefaults: compiled.nativeDefaults,
    selectedInternalId: 0,
    holderPresent: false,
  };
}

export function createZeroReferenceFixedTimeController({
  kernel,
  initialization,
  terrain,
}) {
  if (
    typeof kernel?.initialize !== "function" ||
    typeof kernel?.step !== "function" ||
    typeof initialization?.initializeFixedSpeedPacket !== "function" ||
    typeof terrain?.sampleHeight !== "function"
  )
    throw Error("Verified numeric, packet and terrain dependencies required");
  function initialize({ record, start, spec }) {
    if (
      spec?.policy !== ZERO_REFERENCE_FIXED_TIME_POLICY ||
      !spec.resolved ||
      !spec.settings.mTracksTarget ||
      spec.settings.mUseGroundHeightAtTarget !== true ||
      spec.selectedInternalId !== 0 ||
      spec.holderPresent !== false
    )
      throw Error("Resolved original zero-reference specification required");
    if (
      record.stream !== 1 ||
      record.elapsedSeconds !== 0 ||
      record.replicationPhase !== 0 ||
      record.pendingChildren !== 0 ||
      record.initialPresentationByte !== 0 ||
      record.controllerScalarB0 !== f(3.4028234663852886e38) ||
      record.controllerScalarB4 !== 0 ||
      record.cast.targetCount !== 0 ||
      !Array.isArray(record.cast.requestedTargets) ||
      record.cast.requestedTargets.length ||
      record.cast.overrideFlag14d !== 0 ||
      !requireEmptyCastIndexedOverrides(record.cast).resolved
    )
      throw Error("Exact first zero-reference packet fields required");
    if (start?.status !== "initialized" || start.attachmentHeightOffset !== 0)
      throw Error(
        "Verified constructor start with zero attachment delta required",
      );
    const target = initializeLatestMissileTarget(
      record,
      spec.settings,
      terrain,
    );
    if (target.status !== "initialized")
      throw Error("Verified nonprojected endpoint required: " + target.status);
    const packet = initialization.initializeFixedSpeedPacket(
      record,
      spec.settings,
      start,
      target,
      terrain,
    );
    if (packet.status !== "initialized-position-fields")
      throw Error("Verified first packet positions required");
    const state = kernel.initialize({
      position: start.position,
      targetPosition: target.position,
      travelTime: spec.settings.mTravelTime,
      startDelay: spec.settings.mStartDelay,
      createdAt: record.time,
      travelTimeOverride: null,
      gravity: spec.gravity,
    });
    const beforePacket = structuredClone(state);
    // Original first FixedTime packet preserves constructor velocity/deadline;
    // its decoded speed replaces controller+a0 even when roots differ slightly.
    state.position = [...packet.currentPosition];
    state.initialPosition = [...packet.initialPosition];
    state.targetPosition = [...packet.targetPosition];
    state.speed = packet.movementSpeed;
    return {
      policy: ZERO_REFERENCE_FIXED_TIME_POLICY,
      selectedInternalId: 0,
      holderPresent: false,
      authoredTracksTarget: true,
      beforePacket,
      state,
      target,
      packet,
      nativeMatchMotionAccepted: false,
    };
  }
  function step(controller, now, delta, globalDelta) {
    if (
      controller?.policy !== ZERO_REFERENCE_FIXED_TIME_POLICY ||
      controller.selectedInternalId !== 0 ||
      controller.holderPresent !== false
    )
      throw Error("Original holder-free zero-reference controller required");
    if (
      !controller.state.targetPosition.every((lane, index) =>
        Object.is(lane, controller.packet.targetPosition[index]),
      )
    )
      throw Error(
        "Zero-reference endpoint mutation requires a separately proven family",
      );
    if (!Number.isFinite(globalDelta) || globalDelta < 0)
      throw Error("Explicit finite original global frame delta required");
    return kernel.step(controller.state, now, delta, globalDelta);
  }
  return Object.freeze({ initialize, step, nativeMatchAccepted: false });
}
