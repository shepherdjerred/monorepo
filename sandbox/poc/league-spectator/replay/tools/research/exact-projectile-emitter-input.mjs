import assert from "node:assert/strict";
import { mapBinHash } from "../map-scene-assets.mjs";

const field = (value, name) => value.fields[mapBinHash(name)];
const constant = (value) => value.fields[mapBinHash("constantValue")].value;
const lanes = (value) => Object.values(value);

// Keep the candidate tied to the complete reviewed authored field set.
// A change such as adding a dynamics table must stop this proof, even if
// the scalar constant in that field is unchanged.
export function readZoeRecastEmitterInput(effect, resources) {
  const emitters = field(effect, "complexEmitterDefinitionData").elements;
  const index = 5;
  const emitter = emitters[index];
  const fields = {
    rate: 1,
    particleLifetime: 5,
    particleLinger: Math.fround(0.2),
    lifetime: 4,
    isSingleParticle: 1,
    emitterName: "missileHead",
    bindWeight: 1,
    EmitterPosition: [0, -30, 0],
    primitive: "VfxPrimitiveArbitraryQuad",
    particleColorTexture: "ASSETS/Shared/Particles/color-hold_2.tex",
    blendMode: 1,
    color: [73 / 255, 93 / 255, 182 / 255, 140 / 255].map(Math.fround),
    pass: 35,
    miscRenderFlags: 1,
    isRotationEnabled: 1,
    birthRotation0: [0, 0, 90],
    birthScale0: [120, 200, 10],
    texture: "ASSETS/Characters/Zoe/Skins/Skin20/Particles/Zoe_Skin20_Q_Bullet_Front.tex",
  };
  assert.equal(effect.pathHash, "f8a40120");
  assert.deepEqual(
    Object.keys(emitter.fields).sort(),
    Object.keys(fields).map(mapBinHash).sort(),
  );

  const authored = Object.fromEntries(
    Object.keys(fields).map((name) => {
      const property = field(emitter, name);
      if (name === "primitive") {
        assert.equal(property.type, "Struct");
        assert.equal(property.classHash, mapBinHash(fields.primitive));
        assert.deepEqual(property.fields, {});
        return [name, fields.primitive];
      }
      if (property.type === "Embedded") {
        assert.deepEqual(Object.keys(property.fields), [
          mapBinHash("constantValue"),
        ]);
        const value = constant(property);
        return [name, typeof value === "object" ? lanes(value) : value];
      }
      if (property.type === "Optional") return [name, property.value.value];
      return [name, property.value];
    }),
  );
  assert.deepEqual(authored, fields);
  const baseTexture = resources.get(authored.texture);
  const particleColorTexture = resources.get(authored.particleColorTexture);
  assert(baseTexture && particleColorTexture);

  return {
    index,
    authored,
    textures: { base: baseTexture, particleColor: particleColorTexture },
    missingDrawEvidence: [
      "replay missile-to-emitter activation and clock",
      "replay missile-to-effect basis and world-space quad placement",
      "native shader permutation and texture cache acquisition",
      "device sampler, blend and depth state binding",
      "GPU submission and framebuffer contribution",
    ],
  };
}
