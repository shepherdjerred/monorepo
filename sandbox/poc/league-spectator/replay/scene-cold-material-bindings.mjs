// Resolve only semantic routes proved by the independent cold authority.
// The old supplied particle-color resource has no admitted native replacement.
import { isSceneAllVisionFog } from "./scene-all-vision-fog.mjs";
import { sameDirectCompiledData as same } from "./latest-direct-compiled-restore.mjs";
export function resolveSceneColdMaterialBindings(
  binding,
  defaults,
  { emitter, nativeSamplers, allVisionFog = null } = {},
) {
  const textures = {};
  for (const [name, texture] of Object.entries(binding.textures)) {
    if (texture.kind === "prepared-texture") textures[name] = texture;
    else if (texture.kind === "original-all-vision-fog-texture") {
      if (
        !isSceneAllVisionFog(allVisionFog) ||
        !same(texture, allVisionFog.binding())
      )
        throw Error("Unowned original all-vision fog binding");
      textures[name] = texture;
    } else if (texture.kind === "supplied-transparent-remap" && defaults)
      textures[name] = defaults.binding({ semantic: "shared-remap" });
    else if (texture.kind === "supplied-white-lookup") {
      const path = emitter?.particleColorTexture;
      if (path !== undefined && path !== null && typeof path !== "string")
        throw Error("Invalid original particle color texture name");
      const base = nativeSamplers?.find((row) => row.layer === "base");
      if (
        !path &&
        defaults?.describe().emptyAuthoredColorBindingProved === true &&
        base
      ) {
        if (!/^(0[0-3]){3}(0[0-1]){2}$/.test(base.descriptorHex))
          throw Error("Original color filter input is invalid");
        textures[name] = defaults.binding({
          semantic: "absent-color",
          authoredPath: path,
          samplerDescriptorHex: "010101" + base.descriptorHex.slice(6),
        });
      } else
        return {
          omitted: {
            effectId: binding.effectId,
            emitterIndex: binding.emitterIndex,
            reasons: ["unprepared-original-particle-color-resource-binding"],
          },
        };
    } else if (texture.kind === "supplied-transparent-remap")
      return {
        omitted: {
          effectId: binding.effectId,
          emitterIndex: binding.emitterIndex,
          reasons: ["unprepared-original-cold-shared-remap-authority"],
        },
      };
    else throw Error("Unknown scene controlled texture binding");
  }
  return { binding: { ...binding, textures } };
}
