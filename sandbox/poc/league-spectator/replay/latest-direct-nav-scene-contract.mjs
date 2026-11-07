export const DIRECT_NAV_SCENE_POLICY =
  "selected-installed-scene-initial-navigation-replay-zero-v1";
// The package is generated from static installed navigation and native source
// observations. It contains no replay entity state or simulation snapshots.
export const DIRECT_NAV_SCENE_PACKAGE_SHA =
  "df02a44dc13587a0c55dbff25950f2c9f22b977138afa0bcad49faf4bddcf327";
export const DIRECT_NAV_SCENE_OMISSIONS = Object.freeze([
  "scene:nav-decoded-map-variant-unrecovered",
  "scene:nav-dynamic-cell-mutations-omitted",
  "scene:nav-replay-zero-clock-epoch-presentation-policy",
  "scene:nav-high-resolution-constructor-default-presentation-policy",
  "scene:nav-original-scene-publication-unrecovered",
  "scene:nav-native-metal-pixel-parity-unverified",
]);
export const DIRECT_NAV_SCENE_REQUIREMENTS = Object.freeze({
  texture: "NAVMESH_MASK_TEXTURE_SharedTexture",
  uniform: "NAV_GRID_XFORM",
});
export const DIRECT_NAV_RECORDED_STATE_REQUIREMENTS = Object.freeze([
  "scene:nav-decoded-map-variant",
  "scene:nav-time-addressable-dynamic-cell-source",
  "scene:nav-native-clock-epoch",
  "scene:nav-recorded-graphics-configuration",
  "scene:nav-original-scene-publication",
]);
