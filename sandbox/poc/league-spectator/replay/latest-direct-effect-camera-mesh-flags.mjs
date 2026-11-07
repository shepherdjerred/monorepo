// Original meshRenderFlags defaults to one. Explicit zero is a distinct source
// value; camera-quad simulation/writing is verified separately for that value.
export const DIRECT_CAMERA_ZERO_MESH_FLAGS_POLICY =
  "native-camera-quad-zero-mesh-render-flags-v1";

export function compileDirectCameraMeshFlags(source, primitive) {
  return primitive === "camera-quad" &&
    Object.hasOwn(source, "meshRenderFlags") &&
    source.meshRenderFlags === 0
    ? DIRECT_CAMERA_ZERO_MESH_FLAGS_POLICY
    : null;
}

export function validateDirectCameraMeshFlags(emitter) {
  const expected = compileDirectCameraMeshFlags(
    emitter.source ?? {},
    emitter.primitive,
  );
  if (
    (emitter.meshRenderFlagsPolicy ?? null) !== expected ||
    (Object.hasOwn(emitter.source ?? {}, "meshRenderFlags") && !expected)
  )
    throw Error("Malformed compiled camera-quad mesh render flags policy");
  return expected;
}
