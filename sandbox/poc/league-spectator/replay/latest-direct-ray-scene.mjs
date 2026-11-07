// Explicit viewer policy. Original constructor resource bytes are proven;
// actual spectator visibility and team-remap state remain unresolved.
export const DIRECT_RAY_SCENE_POLICY = "native-ray-allvision-remap-omitted-v1";
export const DIRECT_RAY_SCENE_RESOURCES = Object.freeze({
  nativeProofSha256:
    "efc9aded57d3389fa85df83a0f95ca27438ae4f91c51a64bbf84252b40031492",
  whiteSha256:
    "ad95131bc0b799c0b1af477fb14fcf26a6a9f76079e48bf090acb7e8367bfd0e",
  transparentSha256:
    "df3f619804a92fdb4057192dc43dd748ea778adc52bc498ce80524c014b81119",
});
export const DIRECT_RAY_SCENE_OMISSIONS = Object.freeze([
  "material:ray-allvision-presentation-policy",
  "material:actual-spectator-fow-flag-unrecovered",
  "material:dynamic-team-visibility-unrecovered",
  "material:actual-vision-extent-unrecovered",
  "material:team-color-remap-omitted",
]);
function floats(v, count, name) {
  if (
    !(Array.isArray(v) || v instanceof Float32Array) ||
    v.length !== count ||
    !Array.from(v).every(
      (x) => typeof x === "number" && Number.isFinite(Math.fround(x)),
    )
  )
    throw Error(`Explicit finite Ray scene ${name} required`);
  const b = new Uint8Array(Math.ceil(count / 4) * 16),
    view = new DataView(b.buffer);
  v.forEach((x, i) => view.setFloat32(i * 4, x, true));
  return b;
}
export function directRayScene({ projectionRows, position }) {
  const texture = (rgba, sha, offset) => ({
    dimension: "texture2d",
    width: 1,
    height: 1,
    rgba: Uint8Array.from(rgba),
    samplerDescriptorHex: "01010100000000000100010100000000",
    samplerParameters: { 10240: 9729, 10241: 9729, 10242: 33071, 10243: 33071 },
    inputPolicy: DIRECT_RAY_SCENE_POLICY,
    resourcePolicy: {
      sourceSha256: sha,
      nativeProofSha256: DIRECT_RAY_SCENE_RESOURCES.nativeProofSha256,
      originalTextureManagerOffset: offset,
    },
  });
  return {
    uniforms: {
      mProj: floats(projectionRows, 16, "projection"),
      vCamera: floats(position, 3, "position"),
      FOG_OF_WAR_PARAMS: floats([0.01, -0.01, 0, 1], 4, "fog policy"),
      RENDERTARGET_IS_SRGB: new Uint8Array(16),
    },
    textures: {
      FOW_MAP_SharedTexture: texture(
        [255, 255, 255, 255],
        DIRECT_RAY_SCENE_RESOURCES.whiteSha256,
        0xa0,
      ),
      PIXEL_COLOR_REMAP_RAMP_SharedTexture: texture(
        [0, 0, 0, 0],
        DIRECT_RAY_SCENE_RESOURCES.transparentSha256,
        0xa8,
      ),
    },
    dataBuffers: {},
    stencilReference: 0,
    blendColor: [0, 0, 0, 0],
    policy: DIRECT_RAY_SCENE_POLICY,
    omissions: [...DIRECT_RAY_SCENE_OMISSIONS],
    scope: {
      nativeSceneRecovered: false,
      actualMatchVisibilityRecovered: false,
      textureBytesFromOriginalConstructor: true,
    },
  };
}
