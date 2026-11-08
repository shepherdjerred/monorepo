// Numeric translation of original873e70 with an explicitly supplied range.
// This does not recover a caster spellbook, dynamic range or live endpoint.
import { createLatestMissileMotion } from "./latest-missiles.mjs";

export const SUPPLIED_RANGE_MISSILE_TARGET_POLICY =
  "native-supplied-range-projected-initial-target-v1";
const f = Math.fround;
const vector = (value) =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((lane) => Number.isFinite(lane) && Number.isFinite(f(lane)));

export function createSuppliedRangeMissileTargetProjection(motionDefinition) {
  createLatestMissileMotion(motionDefinition);
  const threshold = f(motionDefinition.epsilon);
  return Object.freeze({
    project({
      sourcePosition,
      targetPosition,
      range,
      initialTargetHeightOffset = 0,
      useGroundHeightAtTarget,
      terrain,
    }) {
      if (
        !vector(sourcePosition) ||
        !vector(targetPosition) ||
        !Number.isFinite(range) ||
        !Number.isFinite(f(range)) ||
        !Number.isFinite(initialTargetHeightOffset) ||
        !Number.isFinite(f(initialTargetHeightOffset)) ||
        typeof useGroundHeightAtTarget !== "boolean" ||
        typeof terrain?.sampleHeight !== "function" ||
        typeof terrain.sameMovementCell !== "function"
      )
        throw Error(
          "Explicit finite projected-target, range and terrain inputs required",
        );
      if (terrain.sameMovementCell(targetPosition, sourcePosition))
        return {
          resolved: false,
          policy: SUPPLIED_RANGE_MISSILE_TARGET_POLICY,
          status: "unresolved-facing-derived-endpoint",
          position: null,
        };
      const source = sourcePosition.map(f),
        target = targetPosition.map(f);
      let x = f(target[0] - source[0]),
        z = f(target[2] - source[2]);
      const lengthSquared = f(f(f(x * x) + 0) + f(z * z));
      if (lengthSquared > threshold) {
        const inverse = f(1 / f(Math.sqrt(lengthSquared)));
        x = f(x * inverse);
        z = f(z * inverse);
      }
      const selected = Math.max(f(range), 1);
      const position = [
        f(f(x * selected) + source[0]),
        0,
        f(f(z * selected) + source[2]),
      ];
      // Both authored ground-flag values take this initial terrain query. The
      // flag's later attachment-height subtraction is a separate consumer.
      const ground = terrain.sampleHeight(position[0], position[2]);
      if (
        typeof ground?.inside !== "boolean" ||
        (ground.inside && !Number.isFinite(ground.height))
      )
        throw Error("Typed initial endpoint terrain query required");
      position[1] = f(
        f(initialTargetHeightOffset) + (ground.inside ? f(ground.height) : 0),
      );
      return {
        resolved: true,
        policy: SUPPLIED_RANGE_MISSILE_TARGET_POLICY,
        status: "initialized-under-supplied-range-control",
        position,
        groundHeightStatus: ground.inside
          ? "navgrid"
          : "outside-navgrid-native-zero",
        actualCasterRangeRecovered: false,
        actualMatchEndpointAdmitted: false,
      };
    },
  });
}
