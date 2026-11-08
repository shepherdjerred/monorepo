const vector = (value, length) =>
  (Array.isArray(value) || ArrayBuffer.isView(value)) &&
  value.length === length &&
  Array.from(value).every(
    (lane) => typeof lane === "number" && Number.isFinite(Math.fround(lane)),
  );

export function validateDirectPlacementRequirements(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Reflect.ownKeys(value).length !== 2 ||
    !Object.hasOwn(value, "rootBasis") ||
    !Object.hasOwn(value, "boundObjectSize") ||
    typeof value.rootBasis !== "boolean" ||
    (value.boundObjectSize !== null &&
      !Object.is(value.boundObjectSize, 0) &&
      value.boundObjectSize !== "finite-nonnegative")
  )
    throw Error("Exact compiled component placement requirements required");
  return value;
}

// Unknown required world inputs omit a component. They never become guessed
// transforms or unit scales. A basis-independent program may carry an unused
// identity internally, but its placement evidence still reports no root basis.
export function directComponentWorldInputOmissions(program, placement) {
  const required = validateDirectPlacementRequirements(
    program.placementRequirements,
  );
  if (placement.basis != null && !vector(placement.basis, 9))
    throw Error("Resolved effect has no finite column-major system basis");
  if (
    placement.boundObjectSize != null &&
    (typeof placement.boundObjectSize !== "number" ||
      !Number.isFinite(Math.fround(placement.boundObjectSize)) ||
      placement.boundObjectSize < 0)
  )
    throw Error("Finite nonnegative original bound-object size required");
  const reasons = [];
  if (required.rootBasis && placement.basis == null)
    reasons.push("world:component-root-basis-unresolved");
  if (
    required.boundObjectSize === 0 ||
    required.boundObjectSize === "finite-nonnegative"
  ) {
    if (placement.boundObjectSize == null)
      reasons.push("world:component-bound-object-size-unresolved");
    else if (required.boundObjectSize === 0 && placement.boundObjectSize !== 0)
      reasons.push("world:component-nonzero-bound-object-size-untranslated");
  }
  return reasons;
}
