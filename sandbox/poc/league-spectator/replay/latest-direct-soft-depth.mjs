// Exact original180fffb..181003a arithmetic on a supplied camera float pair.
// Actual viewer camera provenance and a scene-depth texture are separate inputs;
// this does not infer that the pair is any particular near/far convention.
const f = Math.fround;
const epsilon = f(0.000001);
export function directSoftDepthConversion(cameraPair) {
  if (
    !(Array.isArray(cameraPair) || cameraPair instanceof Float32Array) ||
    cameraPair.length !== 2 ||
    !Array.from(cameraPair).every(
      (value) => typeof value === "number" && Number.isFinite(f(value)),
    )
  )
    throw Error("Explicit dense finite camera float pair required");
  const a = Math.max(f(cameraPair[0]), epsilon);
  const b = Math.max(f(cameraPair[1]), epsilon);
  return Float32Array.of(f(1 / a), f(-f(b - a) / f(a * b)), 0, 0);
}
