// Inactive supplied-input controls. Numeric endpoints have no actual-world
// ownership brand and cannot authorize ordinary spectator family admission.
import { createLatestMissileMotion } from "./latest-missiles.mjs";
import { createLatestMissileControllers } from "./latest-missile-controllers.mjs";
import { createLatestMissileFrame } from "./latest-missile-frame.mjs";
import { createLatestMissileInitialization } from "./latest-missile-initialization.mjs";
import { zeroTurnMissileEffectBasis } from "./latest-missile-effect-basis.mjs";
import { requireEmptyCastIndexedOverrides } from "./latest-cast-indexed-overrides.mjs";

export const SUPPLIED_NONTRACKING_FIXED_SPEED_POLICY =
  "diagnostic-supplied-input-nontracking-fixed-speed-v1";
const f = Math.fround;
const vector = (v) =>
  Array.isArray(v) &&
  v.length === 3 &&
  v.every((n) => Number.isFinite(n) && Number.isFinite(f(n)));

export function compileSuppliedNontrackingFixedSpeedSpec(
  spec,
  motionDefinition,
  controllerDefinition,
) {
  const motion = createLatestMissileMotion(motionDefinition),
    controllers = createLatestMissileControllers(controllerDefinition),
    component = spec?.movementComponent;
  if (component?.__type !== "FixedSpeedMovement")
    throw Error("Original FixedSpeed source specification required");
  const settings = motion.fixedSpeedSettings(component),
    known = new Set([
      "__type",
      ...Object.keys(settings),
      "mStartBoneName",
      "mTargetBoneName",
    ]),
    reasons = [];
  if (Object.keys(component).some((key) => !known.has(key)))
    reasons.push("movement:unknown-properties");
  for (const [key, value] of Object.entries(settings))
    if (typeof value === "number") {
      if (!Number.isFinite(f(value)))
        throw Error("Finite float32 movement setting required");
      settings[key] = f(value);
    }
  const strings = {};
  for (const key of ["mStartBoneName", "mTargetBoneName"]) {
    strings[key] = Object.hasOwn(component, key) ? component[key] : "";
    if (typeof strings[key] !== "string")
      throw Error("Original movement bone string required");
  }
  if (settings.mTracksTarget !== false)
    reasons.push("target:authored-nontracking-required");
  if (settings.mProjectTargetToCastRange !== true)
    reasons.push("target:projected-endpoint-control-required");
  if (settings.mUseGroundHeightAtTarget !== false)
    reasons.push("target:observed-nonground-flag-required");
  if (settings.mInferDirectionFromFacingIfNeeded !== false)
    reasons.push("target:noncoincident-no-facing-fallback-required");
  if (settings.mUseHeightOffsetAtEnd !== false)
    reasons.push("target:height-offset-at-end");
  if (!(settings.mSpeed > 0)) reasons.push("movement:positive-speed-required");
  for (const key of Object.keys(settings)) {
    const nativeDefault = motionDefinition.fields[key].default;
    if (
      ![
        "mTracksTarget",
        "mProjectTargetToCastRange",
        "mUseGroundHeightAtTarget",
        "mUseHeightOffsetAtEnd",
        "mSpeed",
        "mInferDirectionFromFacingIfNeeded",
      ].includes(key) &&
      !Object.is(
        settings[key],
        typeof nativeDefault === "number" ? f(nativeDefault) : nativeDefault,
      )
    )
      reasons.push(`movement:unverified-setting:${key}`);
  }
  if (!strings.mStartBoneName.length || strings.mTargetBoneName.length)
    reasons.push("attachment:named-source-empty-target-required");
  const height = spec.heightSolver;
  if (
    height?.__type !== "FollowTerrainHeightSolver" ||
    Object.keys(height).some((key) => key !== "__type")
  )
    reasons.push("height:default-follow-terrain-required");
  if (
    spec.verticalFacing?.__type !== "VerticalFacingFaceTarget" ||
    Object.keys(spec.verticalFacing).some((key) => key !== "__type")
  )
    reasons.push("facing:original-face-target-required");
  return {
    policy: SUPPLIED_NONTRACKING_FIXED_SPEED_POLICY,
    diagnosticOnly: true,
    ordinaryAdmission: false,
    resolved: reasons.length === 0,
    reasons,
    settings,
    strings,
    heightController:
      height?.__type === "FollowTerrainHeightSolver"
        ? controllers.heightSettings(height)
        : null,
    verticalFacingType: "VerticalFacingFaceTarget",
  };
}

export function createSuppliedNontrackingFixedSpeedController({
  motionDefinition,
  controllerDefinition,
  terrain,
}) {
  const motion = createLatestMissileMotion(motionDefinition),
    controllers = createLatestMissileControllers(controllerDefinition),
    frame = createLatestMissileFrame(
      controllerDefinition,
      motion,
      controllers,
      terrain,
    ),
    initialization = createLatestMissileInitialization(controllerDefinition);
  function initialize({ record, start, suppliedEndpoint, spec }) {
    if (
      spec?.policy !== SUPPLIED_NONTRACKING_FIXED_SPEED_POLICY ||
      !spec.resolved ||
      spec.diagnosticOnly !== true ||
      spec.ordinaryAdmission !== false
    )
      throw Error(
        "Resolved diagnostic-only nontracking specification required",
      );
    if (
      record.stream !== 1 ||
      record.elapsedSeconds !== 0 ||
      record.pendingChildren !== 0 ||
      record.replicationPhase !== 0 ||
      record.initialPresentationByte !== 0 ||
      record.controllerScalarB0 !== f(3.4028234663852886e38) ||
      record.controllerScalarB4 !== 0 ||
      record.cast.targetCount !== 0 ||
      !Array.isArray(record.cast.requestedTargets) ||
      record.cast.requestedTargets.length ||
      record.cast.overrideFlag14d !== 0 ||
      !requireEmptyCastIndexedOverrides(record.cast).resolved
    )
      throw Error("Exact original first nontracking packet required");
    if (
      start?.status !== "initialized" ||
      !vector(start.position) ||
      ![start.planeHeightOffset, start.attachmentHeightOffset].every(
        (n) => Number.isFinite(n) && Number.isFinite(f(n)),
      ) ||
      !vector(suppliedEndpoint?.position)
    )
      throw Error("Explicit supplied constructor start and endpoint required");
    const target = {
        status: "initialized",
        position: suppliedEndpoint.position.map(f),
      },
      packet = initialization.initializeFixedSpeedPacket(
        record,
        spec.settings,
        start,
        target,
        terrain,
      );
    const prepared = {
      ...record,
      movementType: "FixedSpeedMovement",
      settings: spec.settings,
      uninterpretedMovementFields: [],
      heightController: spec.heightController,
      verticalFacingType: spec.verticalFacingType,
      packetInitialization: packet,
    };
    const state = frame.initialize(prepared, record.time),
      constructorVelocity = motion.fixedSpeedStep(
        start.position,
        target.position,
        spec.settings.mSpeed,
        0,
      ).velocity;
    if (!constructorVelocity.some((n) => n !== 0))
      throw Error(
        "Zero constructor direction requires separate original fallback proof",
      );
    state.velocity = [...constructorVelocity];
    return {
      policy: SUPPLIED_NONTRACKING_FIXED_SPEED_POLICY,
      diagnosticOnly: true,
      ordinaryAdmission: false,
      actualConsumedRangeRecovered: false,
      nativeMatchMotionAccepted: false,
      constructorVelocity,
      packet,
      state,
      initialEffectBasis: zeroTurnMissileEffectBasis(constructorVelocity).basis,
    };
  }
  function step(control, now, delta, globalDelta) {
    if (
      control?.policy !== SUPPLIED_NONTRACKING_FIXED_SPEED_POLICY ||
      control.diagnosticOnly !== true ||
      control.ordinaryAdmission !== false
    )
      throw Error("Diagnostic-only nontracking controller required");
    if (
      !Number.isFinite(globalDelta) ||
      !Number.isFinite(f(globalDelta)) ||
      globalDelta < 0
    )
      throw Error("Explicit finite global frame delta required");
    if (
      !control.state.targetPosition.every((v, i) =>
        Object.is(v, control.packet.targetPosition[i]),
      )
    )
      throw Error("Retained supplied endpoint changed");
    return frame.step(control.state, now, delta);
  }
  return Object.freeze({ initialize, step });
}

// This planner deliberately emits no traces. A supplied range or forged
// metadata label cannot make it admit a presentation into ordinary playback.
export function planUnadmittedNontrackingFixedSpeedFamily({
  records,
  eventIndex,
  actors,
  endTime,
  build,
  protocol,
}) {
  if (
    build !== "16.21.829.8620" ||
    protocol !== "20e09df23c66b85e" ||
    !Number.isFinite(endTime) ||
    endTime <= 0
  )
    throw Error("Exact-build inactive family inputs required");
  const identities = new Map(
      eventIndex.identities.map((row) => [row.entityId, row]),
    ),
    omitted = [];
  const order = (a, b) =>
    a.time - b.time ||
    a.transportSequence - b.transportSequence ||
    (a.entryOrder ?? 0) - (b.entryOrder ?? 0);
  for (const record of records) {
    if (
      !Number.isFinite(record.time) ||
      record.time < 0 ||
      !Number.isSafeInteger(record.sequence) ||
      !Number.isSafeInteger(record.transportSequence) ||
      record.transportSequence < 0 ||
      !Number.isSafeInteger(record.entryOrder ?? 0) ||
      (record.entryOrder ?? 0) < 0 ||
      !Number.isInteger(record.entityId) ||
      record.entityId <= 0 ||
      record.entityId !== record.cast?.networkId ||
      typeof record.payloadSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(record.payloadSha256)
    )
      throw Error("Original ordered source packet identity required");
    if (record.time > endTime) continue;
    const identity = identities.get(record.entityId);
    if (!identity) throw Error("Original missile event identity required");
    const reasons = [
        "target:actual-consumed-caster-range-unrecovered",
        "family:inactive-not-registered",
        ...actors.settings(record.behaviorSpecs).reasons,
      ],
      spec = record.nontrackingSpec;
    if (
      spec?.policy !== SUPPLIED_NONTRACKING_FIXED_SPEED_POLICY ||
      !spec.resolved
    )
      reasons.push(
        ...(spec?.reasons ?? [
          "movement:bounded-source-specification-required",
        ]),
      );
    if (
      record.startInitialization?.resolved !== true ||
      record.startInitialization.status !== "initialized"
    )
      reasons.push(
        ...(record.startInitialization?.reasons ?? [
          "start:owned-causal-named-bone-unresolved",
        ]),
      );
    if (record.stream !== 1 || record.elapsedSeconds !== 0)
      reasons.push("replication:first-zero-age-stream-required");
    if (identity.replications.filter((row) => row.time <= endTime).length !== 1)
      reasons.push("replication:repeated-identity");
    if (record.pendingChildren !== 0 || record.replicationPhase !== 0)
      reasons.push("lifecycle:initial-child-or-phase-history");
    if (record.initialPresentationByte !== 0)
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
    const notifications = identity.events
      .filter((row) => row.time <= endTime)
      .sort(order)
      .map((row) => {
        if (
          !Number.isFinite(row.time) ||
          !Number.isSafeInteger(row.transportSequence) ||
          row.transportSequence < 0 ||
          !Number.isSafeInteger(row.entryOrder ?? 0) ||
          (row.entryOrder ?? 0) < 0
        )
          throw Error("Original notification ordering required");
        if (![56, 99, 497].includes(row.opcode))
          reasons.push("lifecycle:unsupported-notification");
        if (row.opcode === 99 && row.value !== 0)
          reasons.push("presentation:nondefault-state");
        return structuredClone(row);
      });
    omitted.push({
      sequence: record.sequence,
      entityId: record.entityId,
      ownerId: record.cast.ownerId,
      spellHash: record.cast.spellHash,
      time: record.time,
      transportSequence: record.transportSequence,
      entryOrder: record.entryOrder ?? 0,
      payloadSha256: record.payloadSha256,
      sourceEventId: `packet:${record.transportSequence}:entry:${record.entryOrder ?? 0}:missile:${record.entityId}`,
      instanceId: `presentation-missile:${record.entityId}:${record.transportSequence}:${record.entryOrder ?? 0}`,
      sourceRecord: structuredClone(record),
      reasons: [...new Set(reasons)],
      notifications,
    });
  }
  return {
    policy: SUPPLIED_NONTRACKING_FIXED_SPEED_POLICY,
    diagnosticOnly: true,
    ordinaryAdmission: false,
    traces: [],
    omitted,
  };
}
