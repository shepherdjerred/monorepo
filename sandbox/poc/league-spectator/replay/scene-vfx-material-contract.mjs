// This is a distinct exact-build offline recipe. The legacy Map12 material
// reference and all of its profile identities remain unchanged.
export const SCENE_VFX_NATIVE_SOURCES = Object.freeze({
  "animation_rig_native.py":
    "e576145c3549e2d26e66babf40ff9349d52953012f7d6ecc5586706a942fe7c9",
  "prepare-scene-vfx-native.py":
    "e801250a411fd7aa11b377b0d0600454f5e1d7e10fdedb690409a68628512f4e",
  "vfx_asset_native.py":
    "9650f900c9574ee5887636ef49e560937c65ab37c8c484ae2dc184b23b873733",
  "vfx_bound_quad_native.py":
    "30ef5e3651046b272a9a92120289b74b99812b3be91ffc34ac03ab22914276a8",
  "vfx_camera_quad_native.py":
    "ad1147cdfd59bdb4f63944d0747f8cda8b7d8ed73a7d3c7ea84fa2cf8100aca8",
  "vfx_emitter_native.py":
    "041848605b3b4b638d8ce98d2205fe5df8bc00ec9ec5ffd8fbd605d0a8165560",
  "vfx_legacy_quad_native.py":
    "007bfea7ca11c674a546f06e2bc833ff5439d2416f3c1b7184f1db59b1b2bedd",
  "vfx_loaded_quad_native.py":
    "4e67a18bcf7080d667e99497557a626f1ab132907f79def08670cb9fc2b9052a",
  "vfx_postload_native.py":
    "dd0cc2c3f74f87915066582398775326ff1455bd5a43bdd2afe7809593758763",
  "vfx_spawn_native.py":
    "023885a7e1cc5620174e94a0dd2a06b2e18d732db070da405766b8743f4ee38c",
});
export const SCENE_VFX_MATERIAL_SOURCES = Object.freeze({
  "animation_rig_native.py":
    "e576145c3549e2d26e66babf40ff9349d52953012f7d6ecc5586706a942fe7c9",
  "animation_runtime_identity.py":
    "f326f561227cf910cdf1937f072e77835496fb94968f5c103f80e3fa13828c4d",
  "macho.py":
    "f44d244014598dd58279abd0da1c0c0e2cedee1a5e58916244d607599576d61e",
  "observe-scene-vfx-materials.py":
    "23bd177cb977b26b97d66c2b7f2743b65fa63b896d568d8209608440a1892787",
  "prepare-scene-vfx-materials.py":
    "60be1e076a0f603ea7ea3faf5bbf43def7db3a4a5bff39983f38a5da5c7f424d",
  "vfx_asset_native.py":
    "9650f900c9574ee5887636ef49e560937c65ab37c8c484ae2dc184b23b873733",
  "vfx_material_native.py":
    "76abd6e1d7507d4d142f66f4b503474054872e27976b3f88ee0d27196e475577",
  "vfx_spawn_native.py":
    "023885a7e1cc5620174e94a0dd2a06b2e18d732db070da405766b8743f4ee38c",
});
export const SCENE_VFX_INITIALIZER = Object.freeze({
  start: 0x14aa3bf,
  end: 0x14aa5f9,
  sha256: "00eae5fc02558923996c0295b19024eefe81a3a97cb9b33d33ae5c9eae6e55f5",
});
export function sceneMaterialEnvironments(definedObjectMask) {
  if (
    !Number.isInteger(definedObjectMask) ||
    definedObjectMask < 0 ||
    definedObjectMask > 7
  )
    throw Error("Original material pointer predicate mask required");
  const baseline = {
    pass: 0,
    featuresEnabled: true,
    resourceMask: 0,
    systemFogMode: 0,
    graphics34b: false,
    graphics29c: 0,
  };
  return [
    ...Array.from({ length: 8 }, (_, resourceMask) => ({
      ...baseline,
      resourceMask,
    })),
    ...[
      ...Array.from({ length: 6 }, (_, index) => ({ pass: index + 1 })),
      { featuresEnabled: false },
      { systemFogMode: 1 },
      { graphics34b: true, graphics29c: 2 },
    ].map((extra) => ({
      ...baseline,
      resourceMask: definedObjectMask,
      ...extra,
    })),
  ];
}
