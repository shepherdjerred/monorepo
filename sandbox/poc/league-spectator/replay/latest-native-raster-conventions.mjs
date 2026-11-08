// Convert native Metal raster intent to the unchanged-NDC, lower-left GLES
// framebuffer convention. Captured native pipeline state remains independent.
// Original client: 192aaf2..192ab00 and 192769f..19276b6. ANGLE's Metal
// GetFrontfaceWinding inverts GL winding for this viewport-origin relationship.
export const DIRECT_NATIVE_RASTER_COORDINATE_POLICY =
  "metal-upper-left-to-gles-lower-left-unchanged-ndc-v1";

export function directNativeMetalRasterToGles(pipeline, convention) {
  if (
    !pipeline ||
    typeof pipeline !== "object" ||
    !/^[0-9a-f]{64}$/.test(pipeline.descriptorHex) ||
    !pipeline.state ||
    typeof pipeline.state !== "object" ||
    Array.isArray(pipeline.state) ||
    !convention ||
    Object.keys(convention).length !== 2 ||
    convention.targetViewportOrigin !== "lower-left" ||
    convention.clipY !== "unchanged"
  )
    throw Error(
      "Explicit native Metal pipeline and GLES coordinate convention required",
    );
  const raw = Uint8Array.from({ length: 32 }, (_, i) =>
    Number.parseInt(pipeline.descriptorHex.slice(i * 2, i * 2 + 2), 16),
  );
  if (raw[15] > 1)
    throw Error("Unknown native Metal front-winding descriptor value");
  const nativeWinding = raw[15] === 0 ? 1 : 0,
    nativeCullMode = (raw[4] >> 3) & 2,
    enumLabelFrontFace = nativeWinding === 0 ? 0x0900 : 0x0901;
  if (
    pipeline.state.frontFace !== enumLabelFrontFace ||
    pipeline.state.cullFace !== 0x0405 ||
    pipeline.state.cullEnabled !== (nativeCullMode !== 0)
  )
    throw Error(
      "Native raster descriptor and captured enum-label state disagree",
    );
  const sourceState = structuredClone(pipeline.state),
    state = structuredClone(pipeline.state);
  // NDC Y is unchanged. Opposite window-coordinate origins reverse signed
  // framebuffer area, so Metal clockwise corresponds to GLES counterclockwise.
  state.frontFace = nativeWinding === 0 ? 0x0901 : 0x0900;
  return {
    policy: DIRECT_NATIVE_RASTER_COORDINATE_POLICY,
    native: {
      backend: "metal",
      winding: nativeWinding,
      cullMode: nativeCullMode,
      viewportOrigin: "upper-left",
    },
    target: {
      backend: "gles",
      viewportOrigin: "lower-left",
      clipY: "unchanged",
    },
    sourceState,
    state,
    windingReversed: true,
    cullModeChanged: false,
  };
}
