import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { compileLatestDirectEffect } from "./latest-direct-effect-definition.mjs";
import { createDirectEffectKernels } from "./latest-direct-effect-worker.mjs";
import {
  compileDirectRayProgram,
  validateDirectRayProgram,
} from "./latest-direct-effect-ray-program.mjs";
import { validateDirectQuadSpriteProgram } from "./latest-direct-effect-sprite.mjs";
import { validateDirectParticlePaletteProgram } from "./latest-direct-particle-palette.mjs";
import { sha256 } from "./structural-comparison.mjs";
import {
  createLatestDirectRayMaterialPackage,
  validateDirectRayMaterialSelection,
} from "./latest-direct-ray-material-package.mjs";
import { directAttachmentComponentAdmitted } from "./latest-direct-effect-placement-consumers.mjs";
const root = resolve(".cache/replay-spike/public"),
  profile = await Bun.file(`${root}/decoder-16.21-macos/profile.json`).json(),
  manifestBytes = await Bun.file(
    `${root}/latest-effects/manifest.json`,
  ).bytes(),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes)),
  id = "champions/karthus/10/8ad0cea5",
  definitionBytes = await Bun.file(
    `${root}/latest-effects/${manifest.definitions[id].file}`,
  ).bytes(),
  record = JSON.parse(new TextDecoder().decode(definitionBytes)),
  kernels = await createDirectEffectKernels({
    profile,
    packages: Object.fromEntries(
      await Promise.all(
        ["values", "birth", "emission", "samplers"].map(async (name) => [
          name,
          await Bun.file(
            `${root}/decoder-16.21-macos/vfx-${name}.json`,
          ).bytes(),
        ]),
      ),
    ),
  });
const materialFolder = resolve(
    ".cache/replay-spike/research/direct-ray-materials-v28",
  ),
  packageBytes = await Bun.file(`${materialFolder}/package.json`).bytes(),
  materials = await createLatestDirectRayMaterialPackage({
    profile,
    packageBytes,
    effectsManifestBytes: manifestBytes,
  }),
  tokens = new Map(
    await Promise.all(
      [2, 10].map(async (index) => [
        `${id}:${index}`,
        await materials.prepare({
          effectId: id,
          emitterIndex: index,
          passHash: 2700020711,
          variantIndex: 0,
          loadBytes: (path) => Bun.file(`${materialFolder}/${path}`).bytes(),
        }),
      ]),
    ),
  ),
  rayMaterialAdmission = { materials, tokens };
const compile = (extra = {}) =>
  compileLatestDirectEffect({
    id,
    definitionBytes,
    manifest,
    manifestBytes,
    kernels,
    ...extra,
  });

test("installed Karthus rays retain their exact unresolved material boundary", async () => {
  const result = await compileLatestDirectEffect({
    id,
    definitionBytes,
    manifest,
    manifestBytes,
    kernels,
  });
  for (const index of [2, 10]) {
    const source = record.definition.complexEmitterDefinitionData[index];
    expect(compileDirectRayProgram(source)?.textureDivisions).toEqual([4, 1]);
    expect(result.emitters.some((e) => e.index === index)).toBe(false);
    // This gate must remain until an exact owned native material is supplied.
    const omitted = result.unsupported.find((e) => e.index === index);
    expect(omitted.reasons).toEqual([
      "material:ray-native-selection-unprepared",
    ]);
  }
  expect(
    record.definition.complexEmitterDefinitionData[2].particleColorTexture,
  ).toContain("DefaultColorOverlifetime");
});

test("Ray capability keeps shared lifetime, binding, shape and emission gates", async () => {
  const changed = structuredClone(record),
    source = changed.definition.complexEmitterDefinitionData[2];
  source.particleLifetime.constantValue = 0;
  source.bindWeight.constantValue = 0.5;
  source.SpawnShape = { __type: "VfxShapeLegacy" };
  source.rate.constantValue = -1;
  const bytes = new TextEncoder().encode(JSON.stringify(changed)),
    revised = structuredClone(manifest);
  revised.definitions[id].sha256 = await sha256(bytes);
  const result = await compileLatestDirectEffect({
      id,
      definitionBytes: bytes,
      manifest: revised,
      manifestBytes: new TextEncoder().encode(JSON.stringify(revised)),
      kernels,
    }),
    reasons = result.unsupported.find((e) => e.index === 2).reasons;
  expect(reasons).toContain("birth:lifetime");
  expect(reasons).toContain("binding:nonconstant-weight");
  expect(reasons).toContain("shape:VfxShapeLegacy");
  expect(result.emitters.some((e) => e.index === 2)).toBe(false);
});

test("quad-specific validators accept only an independently valid Ray controller", async () => {
  const compiled = await compile({ rayMaterialAdmission }),
    ray = compiled.emitters.find((e) => e.index === 2);
  expect(ray.primitive).toBe("ray");
  expect(validateDirectQuadSpriteProgram(ray)).toBeNull();
  expect(validateDirectParticlePaletteProgram(ray)).toBeNull();
  expect(() =>
    validateDirectQuadSpriteProgram({ ...ray, rayProgram: null }),
  ).toThrow();
  expect(() =>
    validateDirectParticlePaletteProgram({ ...ray, rayProgram: null }),
  ).toThrow();
  expect(() =>
    validateDirectQuadSpriteProgram({
      ...ray,
      spriteProgram: { numFrames: 4 },
    }),
  ).toThrow();
  expect(() =>
    validateDirectParticlePaletteProgram({
      ...ray,
      paletteTexture: { kind: "texture" },
    }),
  ).toThrow();
});

test("both unchanged installed Rays require owned material approval and preserve distinct programs", async () => {
  const compiled = await compile({ rayMaterialAdmission });
  for (const index of [2, 10]) {
    const ray = compiled.emitters.find((e) => e.index === index);
    expect(ray.primitive).toBe("ray");
    expect(ray.source).toMatchObject(
      record.definition.complexEmitterDefinitionData[index],
    );
    expect(ray.rayMaterialSelection.status).toBe(
      "owned-direct-ray-material-selection",
    );
    expect(ray.rayMaterialSelection.sourceDefinitionSha256).toBe(
      manifest.definitions[id].sha256,
    );
    expect(ray.rayPaletteTexture.sourceSha256).toBe(
      ray.rayMaterialSelection.textures.find(
        (t) => t.name === "PARTICLE_COLOR_TEXTURE__TX",
      ).sourceSha256,
    );
    expect(ray.spriteProgram).toBeNull();
    expect(ray.paletteProgram).toBeNull();
    expect(ray.paletteTexture).toBeNull();
    expect(ray.placementRequirements.rootBasis).toBe(true);
    expect(ray.lifecycleProgram).toBeNull();
    expect(ray.omissions).toContain(
      "lifecycle:primitive-controller-untranslated:ray",
    );
    expect(ray.omissions).toContain(
      "material:ray-allvision-presentation-policy",
    );
    expect(validateDirectRayProgram(ray)).toEqual(ray.rayProgram);
    expect(
      validateDirectRayMaterialSelection(ray, {
        id,
        definitionHash: compiled.definitionHash,
        index,
      }),
    ).toBe(ray.rayMaterialSelection);
    expect(directAttachmentComponentAdmitted(compiled, ray)).toBe(true);
  }
});

test("lookalike factories, cloned tokens and wrong-emitter material ownership reject", async () => {
  await expect(
    compile({ rayMaterialAdmission: { materials: { ...materials }, tokens } }),
  ).rejects.toThrow("Owned Ray material factory");
  await expect(
    compile({
      rayMaterialAdmission: {
        materials,
        tokens: new Map([[`${id}:2`, structuredClone(tokens.get(`${id}:2`))]]),
      },
    }),
  ).rejects.toThrow("Owned Ray material token");
  await expect(
    compile({
      rayMaterialAdmission: {
        materials,
        tokens: new Map([[`${id}:2`, tokens.get(`${id}:10`)]]),
      },
    }),
  ).rejects.toThrow("Malformed compiled owned Ray material selection");
});

test("serialized Ray source, ownership, resources and basis contracts cannot be forged", async () => {
  const compiled = await compile({ rayMaterialAdmission }),
    ray = compiled.emitters.find((e) => e.index === 2);
  for (const mutate of [
    (e) => {
      e.rayProgram.numFrames = 8;
    },
    (e) => {
      e.source.texDiv[0] = 8;
    },
    (e) => {
      e.inheritSystemBasis = true;
    },
    (e) => {
      e.materialKey = `${id}:10`;
    },
    (e) => {
      e.materialPolicy = "forged-policy";
    },
    (e) => {
      e.rayMaterialSelection.shaderPair.vertex = "0".repeat(64);
    },
    (e) => {
      e.rayMaterialSelection.sourceDefinitionSha256 = "0".repeat(64);
    },
    (e) => {
      e.rayMaterialSelection.emitterIndex = 10;
    },
    (e) => {
      e.rayMaterialSelection.pipeline.descriptorHex = "00".repeat(32);
    },
    (e) => {
      e.rayMaterialSelection.textures[0].sourceSha256 = "0".repeat(64);
    },
    (e) => {
      e.rayPaletteTexture.sourceSha256 = "0".repeat(64);
    },
    (e) => {
      e.rayMaterialSelection = null;
    },
    (e) => {
      e.rayProgram = null;
    },
  ]) {
    const changed = structuredClone(ray);
    mutate(changed);
    expect(() =>
      directAttachmentComponentAdmitted(compiled, changed),
    ).toThrow();
  }
  expect(
    directAttachmentComponentAdmitted(compiled, { primitive: "beam" }),
  ).toBe(false);
});
