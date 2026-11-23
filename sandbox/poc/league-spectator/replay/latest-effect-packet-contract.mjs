// Original packet codecs and descriptor prefix; scene selection cannot change them.
import {
  MAP11_BASE_SCENE_SHA,
  MAP11_NEUTRAL_SCENE_SHA,
  MAP11_NEUTRAL_EFFECT_PLACEMENT_SHA,
  MAP11_NEUTRAL_EFFECT_DESCRIPTOR_SHA,
  MAP11_ORDINAL_SCENE_SHA,
  MAP11_ORDINAL_EFFECT_PLACEMENT_SHA,
  MAP11_ORDINAL_EFFECT_DESCRIPTOR_SHA,
  MAP11_CORPUS_SCENE_SHA,
  MAP11_CORPUS_EFFECT_PLACEMENT_SHA,
  MAP11_CORPUS_EFFECT_DESCRIPTOR_SHA,
} from "./latest-map11-neutral-contract.mjs";
export const EFFECT_PLACEMENT_PACKAGE_SHA =
  "09b87b52ae88f9d869c29c00bbc30da183310f078c4195aac070b6ab1b9feafa";
export const EFFECT_DESCRIPTOR_PACKAGE_SHA =
  "df8f4a47e6e869f41124cc0a93d798e40e5f18796479b9fcc5e486fc22178472";
// Independently executed original quantization/descriptor prefixes for the
// archived Map11 scene. These do not admit entity attachment or factory calls.
export const MAP11_EFFECT_PLACEMENT_PACKAGE_SHA =
  "dae8cb7b090f01754ea9580bd20b123b02a89fd62efe39347936829ff83b23c6";
export const MAP11_EFFECT_DESCRIPTOR_PACKAGE_SHA =
  "eb286328ac5aa35e1e8fd98b88cc55a1ac1be9d5caec3560cf0053c10fa19e03";
export function approvedEffectPacketReferenceSha(
  kind,
  mapId,
  referenceSceneSha256 = null,
) {
  if (
    mapId === 11 &&
    referenceSceneSha256 !== null &&
    referenceSceneSha256 !== MAP11_BASE_SCENE_SHA &&
    referenceSceneSha256 !== MAP11_NEUTRAL_SCENE_SHA &&
    referenceSceneSha256 !== MAP11_ORDINAL_SCENE_SHA &&
    referenceSceneSha256 !== MAP11_CORPUS_SCENE_SHA
  )
    throw Error(
      "No independently approved effect packet program for selected map",
    );
  if (kind === "placement") {
    if (mapId === 12) return EFFECT_PLACEMENT_PACKAGE_SHA;
    if (mapId === 11 && referenceSceneSha256 === MAP11_CORPUS_SCENE_SHA)
      return MAP11_CORPUS_EFFECT_PLACEMENT_SHA;
    if (mapId === 11 && referenceSceneSha256 === MAP11_ORDINAL_SCENE_SHA)
      return MAP11_ORDINAL_EFFECT_PLACEMENT_SHA;
    if (mapId === 11 && referenceSceneSha256 === MAP11_NEUTRAL_SCENE_SHA)
      return MAP11_NEUTRAL_EFFECT_PLACEMENT_SHA;
    if (mapId === 11) return MAP11_EFFECT_PLACEMENT_PACKAGE_SHA;
  } else if (kind === "descriptor") {
    if (mapId === 12) return EFFECT_DESCRIPTOR_PACKAGE_SHA;
    if (mapId === 11 && referenceSceneSha256 === MAP11_CORPUS_SCENE_SHA)
      return MAP11_CORPUS_EFFECT_DESCRIPTOR_SHA;
    if (mapId === 11 && referenceSceneSha256 === MAP11_ORDINAL_SCENE_SHA)
      return MAP11_ORDINAL_EFFECT_DESCRIPTOR_SHA;
    if (mapId === 11 && referenceSceneSha256 === MAP11_NEUTRAL_SCENE_SHA)
      return MAP11_NEUTRAL_EFFECT_DESCRIPTOR_SHA;
    if (mapId === 11) return MAP11_EFFECT_DESCRIPTOR_PACKAGE_SHA;
  }
  throw Error(
    "No independently approved effect packet program for selected map",
  );
}
