import {
  createLatestMissileMotion,
  bindLatestMissileSpell,
  initializeLatestMissileTarget,
} from "./latest-missiles.mjs";
import { compileMissileEffectBasisProgram } from "./latest-missile-effect-basis.mjs";
const f = Math.fround;
const number = (value) => Number.isFinite(value) && Number.isFinite(f(value));

// The original FixedTime spec extends the same movement header and replaces
// offset5c with mTravelTime. Unknown fields never inherit FixedSpeed admission.
export function compileFixedTimeSpec(component, motionDefinition) {
  if (
    component?.__type !== "FixedTimeMovement" ||
    motionDefinition?.build !== "16.21.829.8620"
  )
    throw Error("Exact original FixedTime specification required");
  createLatestMissileMotion(motionDefinition); // Validate the pinned shared header layout.
  const common = {};
  for (const [key, field] of Object.entries(motionDefinition.fields)) {
    if (key === "mSpeed") continue;
    const value = Object.hasOwn(component, key)
      ? component[key]
      : field.default;
    if (field.type === "bool") {
      if (typeof value !== "boolean")
        throw Error(`Typed FixedTime ${key} required`);
      common[key] = value;
    } else {
      if (field.type !== "f32" || !number(value))
        throw Error(`Finite float32 FixedTime ${key} required`);
      common[key] = f(value);
    }
  }
  const known = new Set([
    "__type",
    ...Object.keys(common),
    "mTravelTime",
    "mStartBoneName",
    "mTargetBoneName",
  ]);
  const unknown = Object.keys(component).filter((key) => !known.has(key));
  const travelTime = Object.hasOwn(component, "mTravelTime")
    ? component.mTravelTime
    : 0;
  if (!number(travelTime))
    throw Error("Finite float32 FixedTime mTravelTime required");
  const strings = {};
  for (const key of ["mStartBoneName", "mTargetBoneName"]) {
    const value = Object.hasOwn(component, key) ? component[key] : "";
    if (typeof value !== "string")
      throw Error(`Typed FixedTime ${key} required`);
    strings[key] = value;
  }
  return {
    settings: { ...common, mTravelTime: f(travelTime) },
    strings,
    unknown,
    nativeDefaults: Object.keys(common).filter(
      (key) => !Object.hasOwn(component, key),
    ),
    travelTimeDefaulted: !Object.hasOwn(component, "mTravelTime"),
  };
}
export function compileDefaultGravitySolver(spec) {
  if (!spec || spec.__type !== "GravityHeightSolver")
    return {
      resolved: false,
      reason: "height:fixed-time-default-gravity-type-required",
    };
  const unknown = Object.keys(spec).filter(
    (key) => !["__type", "mGravity"].includes(key),
  );
  if (unknown.length)
    return {
      resolved: false,
      reason: `height:gravity-properties:${unknown.join(",")}`,
    };
  const gravity = Object.hasOwn(spec, "mGravity") ? spec.mGravity : 0;
  if (!number(gravity))
    throw Error("Finite float32 GravityHeightSolver mGravity required");
  return {
    resolved: true,
    gravity: f(gravity),
    nativeSpecOffset0c: f(3.4028234663852886e38),
    nativeSpecByte10: false,
    provenance: "original-gravity-default-offset0c-maximum-and-byte10-clear",
  };
}
export function prepareFixedTimeRecords({
  report,
  subjects,
  motionDefinition,
  initialization,
  terrain,
}) {
  const byId = new Map(subjects.map((row) => [row.entityId, row]));
  const records = [];
  for (const record of report.missiles) {
    const binding = bindLatestMissileSpell(record, byId),
      spec = binding.spell?.data.mMissileSpec;
    if (spec?.movementComponent?.__type !== "FixedTimeMovement") continue;
    const compiled = compileFixedTimeSpec(
      spec.movementComponent,
      motionDefinition,
    );
    const start = initialization.initializeStart(
        record,
        binding.spell.data,
        terrain,
      ),
      target = initializeLatestMissileTarget(
        record,
        compiled.settings,
        terrain,
      );
    const packet = initialization.initializeFixedSpeedPacket(
      record,
      compiled.settings,
      start,
      target,
      terrain,
    );
    records.push({
      ...record,
      ownerCharacter: binding.ownerCharacter,
      definitionName: binding.spell.name,
      effectBasisProgram: compileMissileEffectBasisProgram(binding.spell.data, {
        spellHash: record.cast.spellHash,
        spellName: binding.spell.name,
        catalogSha256: byId.get(record.cast.ownerId)?.catalogSha256,
      }),
      movementType: "FixedTimeMovement",
      settings: compiled.settings,
      targetBoneName: compiled.strings.mTargetBoneName,
      sourceBoneName: compiled.strings.mStartBoneName,
      uninterpretedMovementFields: compiled.unknown,
      heightController: compileDefaultGravitySolver(spec.heightSolver),
      verticalFacingType: spec.verticalFacing?.__type ?? null,
      verticalFacingProperties: Object.keys(spec.verticalFacing ?? {}).filter(
        (key) => key !== "__type",
      ),
      behaviorSpecs: spec.behaviors ?? [],
      startInitialization: start,
      targetInitialization: target,
      packetInitialization: packet,
    });
  }
  return records;
}
