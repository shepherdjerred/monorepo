import {
  createLatestDirectRayMaterialPackage,
  DIRECT_RAY_SHADER_PAIR,
} from "./latest-direct-ray-material-package.mjs";
import { compileDirectRayProgram } from "./latest-direct-effect-ray-program.mjs";
import { normalizeDirectPointEmitter } from "./latest-direct-effect-defaults.mjs";

// Native material observations are separate from simulation eligibility. Only
// this observed shader/pass route may accompany the current Ray controller.
export async function loadLatestDirectRayPackage({
  load,
  profile,
  manifestBytes,
  records,
}) {
  if (typeof load !== "function" || !Array.isArray(records))
    throw Error("Explicit Ray source records and asset loader required");
  const directory = "latest-direct-ray-materials";
  const materials = await createLatestDirectRayMaterialPackage({
    profile,
    packageBytes: await load(`${directory}/package.json`),
    effectsManifestBytes: manifestBytes,
  });
  const inventory = materials.inventory(),
    tokens = new Map(),
    metadata = new Map();
  for (const record of records) {
    if (typeof record.id !== "string" || !record.definition)
      throw Error("Ray source definition identity required");
    for (const [index, authored] of (
      record.definition.complexEmitterDefinitionData ?? []
    ).entries()) {
      if (authored?.primitive?.__type !== "VfxPrimitiveRay") continue;
      if (!compileDirectRayProgram(normalizeDirectPointEmitter(authored)))
        continue;
      const observed = inventory.find(
        (e) => e.effectId === record.id && e.emitterIndex === index,
      );
      const candidates =
        observed?.rows
          .filter((row) => row.name === "post_distortion")
          .flatMap((row) =>
            row.variants.flatMap((variant, variantIndex) =>
              Object.entries(DIRECT_RAY_SHADER_PAIR).every(
                ([side, hash]) => variant.shaders[side].sha256 === hash,
              )
                ? [{ passHash: row.hash, variantIndex }]
                : [],
            ),
          ) ?? [];
      if (candidates.length > 1)
        throw Error("Ambiguous original Ray material route");
      if (!candidates.length) continue;
      const token = await materials.prepare({
        effectId: record.id,
        emitterIndex: index,
        ...candidates[0],
        loadBytes: (file) => load(`${directory}/${file}`),
      });
      const key = `${record.id}:${index}`;
      metadata.set(key, materials.inspect(token));
      tokens.set(key, token);
    }
  }
  return { materials, tokens, metadata };
}
