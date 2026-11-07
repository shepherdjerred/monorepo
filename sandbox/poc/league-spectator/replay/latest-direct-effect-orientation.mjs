const zeroVector = (value) =>
  Array.isArray(value) &&
  value.length === 3 &&
  Reflect.ownKeys(value).length === 4 &&
  [0, 1, 2].every(
    (index) => Object.hasOwn(value, index) && Object.is(value[index], 0),
  );

export const DIRECT_CAMERA_ORIENTATION_OMISSION =
  "orientation:native-particle-and-matrix-streams-unconsumed-by-camera-writer";

// This requirement predicate consumes already-normalized compiler inputs.
// Native camera-writer controls establish geometry independence for zero local
// position and velocity. Retained native orientation streams remain separate;
// this never supplies or claims an original missile/system basis.
export function directCameraBasisIndependent({
  primitive,
  offset,
  emitterPosition,
  velocity,
}) {
  return (
    primitive === "camera-quad" &&
    zeroVector(offset) &&
    (emitterPosition === undefined || zeroVector(emitterPosition)) &&
    (velocity === undefined || zeroVector(velocity))
  );
}
