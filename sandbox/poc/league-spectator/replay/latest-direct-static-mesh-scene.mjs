// Explicit presentation policy, separate from native scene-state recovery.
export const DIRECT_STATIC_MESH_SCENE_POLICY =
  "native-static-mesh-allvision-remap-omitted-v1";
export const DIRECT_STATIC_MESH_SCENE_OMISSIONS = Object.freeze([
  "material:mesh-allvision-presentation-policy",
  "material:actual-spectator-fow-flag-unrecovered",
  "material:dynamic-team-visibility-unrecovered",
  "material:actual-vision-extent-unrecovered",
  "material:team-color-remap-omitted",
  "material:allvision-edge-control-explicit-presentation-override",
]);
export const DIRECT_STATIC_MESH_SCENE_RESOURCES = Object.freeze({
  nativeProofSha256:
    "efc9aded57d3389fa85df83a0f95ca27438ae4f91c51a64bbf84252b40031492",
  whiteSha256:
    "ad95131bc0b799c0b1af477fb14fcf26a6a9f76079e48bf090acb7e8367bfd0e",
  transparentSha256:
    "df3f619804a92fdb4057192dc43dd748ea778adc52bc498ce80524c014b81119",
  originalTextureManagerOffsets: Object.freeze([0xa0, 0xa8]),
});
const vector = (value, n, name) => {
  if (
    !(Array.isArray(value) || value instanceof Float32Array) ||
    value.length !== n ||
    !Array.from(value).every(
      (v) => typeof v === "number" && Number.isFinite(Math.fround(v)),
    )
  )
    throw Error(`Explicit finite static mesh scene ${name} required`);
  return Float32Array.from(value);
};
const bytes = (values) => {
  const out = new Uint8Array(Math.ceil(values.length / 4) * 16),
    view = new DataView(out.buffer);
  values.forEach((x, i) => view.setFloat32(i * 4, x, true));
  return out;
};
export function directStaticMeshScene({
  projectionRows,
  position,
  forward,
  up,
}) {
  const projection = vector(projectionRows, 16, "projection"),
    camera = vector(position, 3, "position"),
    facing = vector(forward, 3, "forward"),
    vertical = vector(up, 3, "up");
  for (const axis of [facing, vertical])
    if (!axis.some((v) => v !== 0))
      throw Error("Nonzero static mesh camera axes required");
  const nativeTexture = (name, rgba, sourceSha256) => ({
    dimension: "texture2d",
    width: 1,
    height: 1,
    rgba: Uint8Array.from(rgba),
    samplerDescriptorHex: "01010100000000000100010100000000",
    samplerParameters: { 10240: 9729, 10241: 9729, 10242: 33071, 10243: 33071 },
    inputPolicy: DIRECT_STATIC_MESH_SCENE_POLICY,
    resourcePolicy: {
      name,
      sourceSha256,
      nativeProofSha256: DIRECT_STATIC_MESH_SCENE_RESOURCES.nativeProofSha256,
    },
  });
  return {
    uniforms: {
      mProj: bytes(projection),
      vCamera: bytes(camera),
      mCameraForward: bytes(facing),
      mCameraUp: bytes(vertical),
      FOG_OF_WAR_PARAMS: bytes([0.01, -0.01, 0, 1]),
      // Alpha1 and edge.w1 yield a fog multiplier1 for ANY finite shader z.
      // These values are declared scene policy, not a recovered native setter.
      FOG_OF_WAR_ALWAYS_BELOW_Y: bytes([0, 0, 0, 1]),
      FOW_EDGE_CONTROL: bytes([0, 0, 0, 1]),
      RENDERTARGET_IS_SRGB: new Uint8Array(16),
      INSTANCE_FACING_DATA: new Uint8Array(16),
    },
    textures: {
      FOW_MAP_SharedTexture: nativeTexture(
        "native-texture-manager-a0",
        [255, 255, 255, 255],
        DIRECT_STATIC_MESH_SCENE_RESOURCES.whiteSha256,
      ),
      PIXEL_COLOR_REMAP_RAMP_SharedTexture: nativeTexture(
        "native-texture-manager-a8-remap-omitted",
        [0, 0, 0, 0],
        DIRECT_STATIC_MESH_SCENE_RESOURCES.transparentSha256,
      ),
    },
    dataBuffers: {},
    stencilReference: 0,
    blendColor: [0, 0, 0, 0],
    policy: DIRECT_STATIC_MESH_SCENE_POLICY,
    omissions: [...DIRECT_STATIC_MESH_SCENE_OMISSIONS],
    scope: {
      nativeSceneRecovered: false,
      nativeAlwaysBelowSetterRecovered: false,
      actualMatchVisibilityRecovered: false,
      textureBytesFromOriginalConstructor: true,
    },
  };
}
