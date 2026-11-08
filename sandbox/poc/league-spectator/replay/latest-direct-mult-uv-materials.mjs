// Own the existing original MULT_PASS material observations. Compiled constant
// UVs alone cannot establish shader selection, texture identity or samplers.
import { sha256 } from "./structural-comparison.mjs";
import { PARENT_QUAD_GPU_SHA } from "./latest-parent-render-frame.mjs";
import { validateDirectMultUv } from "./latest-direct-effect-mult-uv.mjs";
import { assertLatestSelectedMaterials } from "./latest-selected-materials.mjs";
const owned = new WeakSet();
const vertex =
    "903a023260c71aa435f3edcfaf6eebf4d2b4c864c490c95103aff8c95087e314",
  pixel = "681f2099e2f3b0d830f0b8800a75a3c8f6355a34740020fb436725f2956c2f3d",
  globals =
    "0000803f0000803f0000803f000000000000803f0000803f0000803f0000000000000000000000000000000000000000",
  parse = (b) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b));
const canonical = (v) => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
};
export function isLatestDirectMultUvMaterials(value) {
  return owned.has(value);
}
export async function createLatestDirectMultUvMaterials({
  effectsManifestBytes,
  quadPackageBytes,
  selectedMaterials = null,
}) {
  if (selectedMaterials !== null)
    await assertLatestSelectedMaterials(selectedMaterials).assertPackages({
      effectsManifestBytes,
      quadPackageBytes,
      trailPackageBytes: selectedMaterials.packageBytes("trail"),
      erosionPackageBytes: selectedMaterials.packageBytes("erosion"),
    });
  if (
    !(effectsManifestBytes instanceof Uint8Array) ||
    !(quadPackageBytes instanceof Uint8Array) ||
    (selectedMaterials === null &&
      (await sha256(quadPackageBytes)) !== PARENT_QUAD_GPU_SHA)
  )
    throw Error("Pinned original quad materials and byte manifest required");
  const manifest = parse(effectsManifestBytes),
    data = parse(quadPackageBytes),
    byKey = new Map();
  if (
    data.build !== "16.21.829.8620" ||
    data.protocol !== "20e09df23c66b85e" ||
    data.build !== manifest.build ||
    data.protocol !== manifest.protocol ||
    data.effectsManifestSha256 !== (await sha256(effectsManifestBytes)) ||
    data.counts.emitters !== data.emitters.length
  )
    throw Error("Exact-build original multiply material package required");
  for (const prepared of data.emitters) {
    const key = `${prepared.effectId}:${prepared.emitterIndex}`,
      ref = manifest.definitions[prepared.effectId];
    if (
      byKey.has(key) ||
      !ref ||
      prepared.sourceDefinitionSha256 !== ref.sha256
    )
      throw Error(
        "Unique native multiply material definition identity required",
      );
    byKey.set(key, prepared);
  }
  function admit(emitter, prepared) {
    if (!validateDirectMultUv(emitter)) return { supported: true, reasons: [] };
    const expected = byKey.get(emitter.materialKey);
    if (!expected || !prepared)
      return {
        supported: false,
        reasons: ["material:owned-native-mult-selection-unprepared"],
      };
    if (canonical(prepared) !== canonical(expected))
      throw Error("Multiply material differs from owned original observation");
    const g = prepared.blocks.filter((b) => b.glslName === "Globals_vs"),
      environment = {
        pass: 0,
        featuresEnabled: true,
        resourceMask: 1,
        systemFogMode: 1,
        graphics34b: false,
        graphics29c: 0,
      },
      defines = [
        { name: "ALPHA_TEST", value: "1" },
        { name: "DISABLE_FOW", value: "1" },
        { name: "MULT_PASS", value: "1" },
      ],
      sorted = (d) => [...d].sort((a, b) => a.name.localeCompare(b.name));
    if (
      emitter.groundLayer ||
      prepared.family !== "quad" ||
      canonical(prepared.environment) !== canonical(environment) ||
      canonical(sorted(prepared.nativeDefines)) !== canonical(defines) ||
      canonical(sorted(prepared.defines)) !== canonical(defines) ||
      prepared.shaders.vertex.sha256 !== vertex ||
      prepared.shaders.pixel.sha256 !== pixel ||
      g.length !== 1 ||
      g[0].size !== 48 ||
      g[0].bytesHex !== globals ||
      g[0].sceneMembers.length !== 0 ||
      canonical(Object.keys(prepared.textures).sort()) !==
        canonical(
          [
            "PARTICLE_COLOR_TEXTURE_TX",
            "PIXEL_COLOR_REMAP_RAMP_SharedTexture",
            "TEXTUREMULT_TX",
            "TEXTURE_TX",
          ].sort(),
        ) ||
      prepared.textures.PARTICLE_COLOR_TEXTURE_TX.kind !==
        "supplied-white-lookup" ||
      prepared.textures.PIXEL_COLOR_REMAP_RAMP_SharedTexture.kind !==
        "supplied-transparent-remap"
    )
      return {
        supported: false,
        reasons: ["material:native-constant-mult-pass0-default-atlas-subset"],
      };
    const pixelated = emitter.source.isTexturePixelated ?? false;
    if (![0, 1, false, true].includes(pixelated))
      throw Error("Typed original texture filter selector required");
    for (const [name, path, authored] of [
      [
        "TEXTURE_TX",
        emitter.source.texture,
        emitter.source.texAddressModeBase ?? 0,
      ],
      [
        "TEXTUREMULT_TX",
        emitter.multUvProgram.texture,
        emitter.multUvProgram.addressMode,
      ],
    ]) {
      const asset =
          typeof path === "string" ? manifest.assets[path.toLowerCase()] : null,
        binding = prepared.textures[name],
        engine = [0, 2, 1][authored],
        filter = pixelated ? 0 : 1;
      if (
        !asset ||
        asset.status !== "prepared" ||
        asset.kind !== "texture" ||
        ![0, 1, 2].includes(authored) ||
        binding.kind !== "prepared-texture" ||
        binding.file !== asset.file ||
        binding.sha256 !== asset.sha256 ||
        binding.sampler.name !== ["repeat", "mirror", "clamp"][authored] ||
        binding.sampler.pixelated !== Boolean(pixelated) ||
        binding.nativeSamplerHex !==
          [engine, engine, engine, filter, filter]
            .map((n) => n.toString(16).padStart(2, "0"))
            .join("")
      )
        throw Error(
          "Original multiply texture asset or native sampler identity differs",
        );
    }
    return { supported: true, reasons: [] };
  }
  const api = Object.freeze({
    admit,
    inventory: () => [...byKey.keys()].sort(),
  });
  owned.add(api);
  return api;
}
