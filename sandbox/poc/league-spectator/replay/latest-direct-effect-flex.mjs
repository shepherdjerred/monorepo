// Original typed Flex constructor, parent bound setter and birth leaf controls
// establish factor1 at size0 and the positive float32 product otherwise.
// The historical predicate name identifies this exact source shape; its
// nonzero current-scale capability is independently declared by the compiler.
export function directZeroBoundFlex(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Reflect.ownKeys(value).length === 2 &&
    Object.hasOwn(value, "__type") &&
    Object.hasOwn(value, "scaleBirthScaleByBoundObjectSize") &&
    value.__type === "VfxFlexShapeDefinitionData" &&
    Object.is(value.scaleBirthScaleByBoundObjectSize, Math.fround(0.005))
  );
}
export function directBoundFlexScale(source, boundObjectSize) {
  if (
    !directZeroBoundFlex(source) ||
    typeof boundObjectSize !== "number" ||
    !Number.isFinite(Math.fround(boundObjectSize)) ||
    boundObjectSize < 0
  )
    throw Error(
      "Verified finite nonnegative bound size and admitted Flex required",
    );
  const f = Math.fround,
    size = f(boundObjectSize);
  // The admitted root has no authored attached-size override. Original parent
  // setter1763fd0 maps wrapper sizes200..500 to parent sizes200..250, and
  // clamps larger inputs to250 before its component Flex loop.
  const parentSize =
    size <= 200
      ? size
      : size >= 500
        ? 250
        : f(f(50 * f(f(size - 200) / 300)) + 200);
  const product = f(f(source.scaleBirthScaleByBoundObjectSize) * parentSize);
  if (!Number.isFinite(product))
    throw Error("Native Flex scale product outside finite float32");
  return product > 0 ? product : 1;
}
