// Original Vector2 emitter+7c -> raster descriptor+18/+1c. The original
// constructor disables all-zero bias and otherwise copies both float32 lanes.
export const DIRECT_DEPTH_BIAS_POLICY =
  "original-camera-quad-raster-depth-bias-v1";
const f = Math.fround;
export function compileDirectDepthBiasProgram(source, primitive) {
  if (!Object.hasOwn(source, "depthBiasFactors")) return null;
  const factors = source.depthBiasFactors;
  if (
    primitive !== "camera-quad" ||
    !Array.isArray(factors) ||
    factors.length !== 2 ||
    !factors.every(
      (v) =>
        typeof v === "number" && Number.isFinite(v) && Number.isFinite(f(v)),
    )
  )
    return null;
  const values = factors.map(f),
    enabled = values.some((v) => v !== 0);
  return Object.freeze({
    schema: 1,
    policy: DIRECT_DEPTH_BIAS_POLICY,
    enabled,
    slope: enabled ? values[0] : 0,
    constant: enabled ? values[1] : 0,
  });
}
export function validateDirectDepthBiasProgram(
  program,
  source,
  primitive,
  nativeRenderStateHex = null,
) {
  const expected = compileDirectDepthBiasProgram(source, primitive);
  if (
    expected === null ||
    program === null ||
    typeof program !== "object" ||
    Object.getPrototypeOf(program) !== Object.prototype ||
    Reflect.ownKeys(program).length !== Object.keys(expected).length
  )
    throw Error(
      "Source-bound original camera-quad depth bias program required",
    );
  for (const [key, value] of Object.entries(expected)) {
    const field = Object.getOwnPropertyDescriptor(program, key);
    if (!field || !("value" in field) || !Object.is(field.value, value))
      throw Error("Original depth bias program differs from source");
  }
  if (nativeRenderStateHex !== null) {
    if (
      typeof nativeRenderStateHex !== "string" ||
      !/^[a-f0-9]{64}$/.test(nativeRenderStateHex)
    )
      throw Error("Exact original32-byte native raster descriptor required");
    const bytes = Uint8Array.from(nativeRenderStateHex.match(/../g), (b) =>
        parseInt(b, 16),
      ),
      view = new DataView(bytes.buffer);
    if (
      !!(bytes[4] & 8) !== expected.enabled ||
      !Object.is(view.getFloat32(24, true), expected.slope) ||
      !Object.is(view.getFloat32(28, true), expected.constant)
    )
      throw Error(
        "Owned material native depth bias differs from compiled source",
      );
  }
  return expected;
}

export function assertDirectDepthBiasRenderer(renderer) {
  if (
    renderer?.capabilities?.reversedDepthBuffer === true ||
    typeof renderer?.state?.buffers?.depth?.getReversed !== "function" ||
    renderer.state.buffers.depth.getReversed() !== false
  )
    throw Error(
      "Native-approved depth bias requires non-reversed renderer depth",
    );
}
