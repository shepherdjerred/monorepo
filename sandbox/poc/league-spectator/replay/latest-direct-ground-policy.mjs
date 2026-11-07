// Explicit omniscient diagnostic material policy. It does not reconstruct the
// recorded spectator flag, dynamic team visibility, or the actual map extent.
import {
  DIRECT_GROUND_POLICY,
  DIRECT_GROUND_OMISSIONS,
} from "./latest-direct-ground-contract.mjs";
export {
  DIRECT_GROUND_POLICY,
  DIRECT_GROUND_OMISSIONS,
} from "./latest-direct-ground-contract.mjs";
export const DIRECT_GROUND_PACKAGE_SHA =
  "29db229f13f6009bf7179891b9d9a5acf5503948cdca5278ebb3a415a143f2fc";

export function directGroundMaterials(packageData, manifest, manifestSha) {
  const p = packageData,
    policy = p.scenePolicy;
  if (
    p.schema !== 1 ||
    p.kind !== "prepared-direct-native-ground-pass-materials" ||
    p.build !== manifest.build ||
    p.protocol !== manifest.protocol ||
    p.effectsManifestSha256 !== manifestSha ||
    policy?.policy !== DIRECT_GROUND_POLICY ||
    policy.rgbaHex !== "ffffffff" ||
    !/^[a-f0-9]{64}$/.test(policy.nativeProofSha256) ||
    policy.nativeTextureSha256 !==
      "ad95131bc0b799c0b1af477fb14fcf26a6a9f76079e48bf090acb7e8367bfd0e" ||
    policy.suppliedExtentControl !== 100 ||
    policy.uniformBytesHex !== "0ad7233c0ad723bc000000000000803f" ||
    JSON.stringify(policy.omissions) !==
      JSON.stringify(DIRECT_GROUND_OMISSIONS) ||
    !Array.isArray(p.emitters) ||
    p.counts.bound !== p.emitters.length ||
    p.counts.omitted !== 0
  )
    throw Error("Unsupported exact native ground all-vision material contract");
  const result = new Map();
  for (const prepared of p.emitters) {
    const key = `${prepared.effectId}:${prepared.emitterIndex}`;
    const fow = Object.values(prepared.textures).filter(
      (t) => t.kind === "native-ground-all-vision",
    );
    if (
      result.has(key) ||
      !Number.isSafeInteger(prepared.emitterIndex) ||
      prepared.emitterIndex < 0 ||
      manifest.definitions[prepared.effectId]?.sha256 !==
        prepared.sourceDefinitionSha256 ||
      prepared.environment?.pass !== 5 ||
      prepared.environment.systemFogMode !== 0 ||
      prepared.materialPolicy !== DIRECT_GROUND_POLICY ||
      JSON.stringify(prepared.scenePolicy) !== JSON.stringify(policy) ||
      fow.length !== 1 ||
      fow[0].rgbaHex !== policy.rgbaHex ||
      fow[0].nativeProofSha256 !== policy.nativeProofSha256 ||
      fow[0].nativeTextureSha256 !== policy.nativeTextureSha256 ||
      fow[0].sampler?.name !== "clamp" ||
      fow[0].sampler.pixelated !== true ||
      !Array.isArray(prepared.nativeBlendFactors) ||
      prepared.nativeBlendFactors.length !== 4 ||
      prepared.nativeBlendFactors.some((f) => ![1, 6, 7].includes(f)) ||
      typeof prepared.suppliedDepthTest !== "boolean" ||
      typeof prepared.suppliedDoubleSide !== "boolean" ||
      !Number.isSafeInteger(prepared.suppliedSortPass)
    )
      throw Error("Invalid exact native ground pass5 binding");
    result.set(key, { key, prepared, primitive: "quad" });
  }
  return result;
}
