import { createLatestDirectStaticMeshMaterials } from "./latest-direct-static-mesh-materials.mjs";
import { createLatestDirectStaticMeshPrograms } from "./latest-direct-effect-static-mesh-program.mjs";
import { normalizeDirectPointEmitter } from "./latest-direct-effect-defaults.mjs";

export const DIRECT_STATIC_MESH_MATERIALS_SHA =
  "22a5540d39acb4c131be8d36335dd8c215e1e092bac216dfb5b920443f43ec32";
export const DIRECT_STATIC_MESH_RESOURCES_SHA =
  "87587b2708d642f9eaa68c0eb8f1cb84339cc42e80c7f50e96fe74c400039eb4";

// Exact shader observations bound the first individual-mesh material slice.
// This selects a shared material implementation; it never selects a champion.
const shaderPair = {
  vertex: "f49ec012c6ebe91e684940232c6ff3a49d3cdb2fb3b506a06f737ca80736d213",
  pixel: "3814249679a8b2ced7156832dee43454edfea0973a5eb039ccc8483562cafb7a",
};

export async function loadLatestDirectStaticMeshPackage({
  load,
  profile,
  manifestBytes,
  records,
}) {
  if (typeof load !== "function" || !Array.isArray(records))
    throw Error(
      "Explicit static mesh source records and asset loader required",
    );
  const programs = await createLatestDirectStaticMeshPrograms({
    profile,
    packageBytes: await load(
      "latest-direct-static-mesh-resources/package.json",
    ),
    expectedPackageSha256: DIRECT_STATIC_MESH_RESOURCES_SHA,
    effectsManifestBytes: manifestBytes,
    loadBytes: (file) => load(`latest-direct-static-mesh-resources/${file}`),
  });
  const materials = await createLatestDirectStaticMeshMaterials({
    profile,
    packageBytes: await load(
      "latest-direct-static-mesh-materials/package.json",
    ),
    expectedPackageSha256: DIRECT_STATIC_MESH_MATERIALS_SHA,
    effectsManifestBytes: manifestBytes,
  });
  const tokens = new Map(),
    metadata = new Map();
  const inventory = materials.inventory();
  for (const record of records) {
    if (typeof record.id !== "string" || !record.definition)
      throw Error("Static mesh source definition identity required");
    for (const [index, authored] of (
      record.definition.complexEmitterDefinitionData ?? []
    ).entries()) {
      if (authored?.primitive?.__type !== "VfxPrimitiveMesh") continue;
      const source = normalizeDirectPointEmitter(authored);
      if (
        programs.compile(source).status !==
        "prepared-static-mesh-primitive-program"
      )
        continue;
      // The currently proven material route is the native ground-layer pass.
      // Other passes remain absent; no normal-pass binding substitutes for it.
      if (source.isGroundLayer !== true && source.isGroundLayer !== 1) continue;
      const observed = inventory.find(
        (e) => e.effectId === record.id && e.emitterIndex === index,
      );
      const candidates =
        observed?.rows
          .filter((r) => r.name === "ground_layer")
          .flatMap((row) =>
            row.variants.flatMap((variant, variantIndex) =>
              Object.entries(shaderPair).every(
                ([side, sha]) => variant.shaders[side].sha256 === sha,
              )
                ? [{ passHash: row.hash, variantIndex }]
                : [],
            ),
          ) ?? [];
      if (candidates.length > 1)
        throw Error("Ambiguous original individual mesh material route");
      if (!candidates.length) continue;
      const token = await materials.prepare({
        effectId: record.id,
        emitterIndex: index,
        ...candidates[0],
        loadBytes: (file) =>
          load(`latest-direct-static-mesh-materials/${file}`),
      });
      const key = `${record.id}:${index}`;
      metadata.set(key, materials.inspectNonInstanced(token));
      tokens.set(key, token);
    }
  }
  return { programs, materials, tokens, metadata };
}
