import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { compileLatestDirectEffect } from "./latest-direct-effect-definition.mjs";
import { createDirectEffectKernels } from "./latest-direct-effect-worker.mjs";
import {
  createLatestDirectStaticMeshPrograms,
  validateDirectStaticMeshProgram,
} from "./latest-direct-effect-static-mesh-program.mjs";
import { sha256 } from "./structural-comparison.mjs";
import { createLatestDirectStaticMeshMaterials } from "./latest-direct-static-mesh-materials.mjs";

const cache = resolve(".cache/replay-spike"),
  assets = `${cache}/public`;
const profile = await Bun.file(
  `${assets}/decoder-16.21-macos/profile.json`,
).json();
const manifestBytes = await Bun.file(
  `${assets}/latest-effects/manifest.json`,
).bytes();
const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
const id = "champions/hecarim/0/e57b8289",
  ref = manifest.definitions[id];
const definitionBytes = await Bun.file(
  `${assets}/latest-effects/${ref.file}`,
).bytes();
const authored = JSON.parse(new TextDecoder().decode(definitionBytes));
const kernels = await createDirectEffectKernels({
  profile,
  packages: Object.fromEntries(
    await Promise.all(
      ["values", "birth", "emission", "samplers"].map(async (name) => [
        name,
        await Bun.file(
          `${assets}/decoder-16.21-macos/vfx-${name}.json`,
        ).bytes(),
      ]),
    ),
  ),
});
const packageBytes = await Bun.file(
  `${assets}/latest-direct-static-mesh-resources/package.json`,
).bytes();
const meshPrograms = await createLatestDirectStaticMeshPrograms({
  profile,
  packageBytes,
  expectedPackageSha256: await sha256(packageBytes),
  effectsManifestBytes: manifestBytes,
  loadBytes: (file) =>
    Bun.file(`${assets}/latest-direct-static-mesh-resources/${file}`).bytes(),
});
const materialFolder = `${cache}/research/direct-static-mesh-materials`;
const materialBytes = await Bun.file(`${materialFolder}/package.json`).bytes();
const materials = await createLatestDirectStaticMeshMaterials({
  profile,
  packageBytes: materialBytes,
  expectedPackageSha256: await sha256(materialBytes),
  effectsManifestBytes: manifestBytes,
});
const token = await materials.prepare({
  effectId: id,
  emitterIndex: 15,
  passHash: 1047222492,
  variantIndex: 0,
  loadBytes: (file) => Bun.file(`${materialFolder}/${file}`).bytes(),
});
const owned = {
  meshPrograms,
  meshMaterialAdmission: { materials, tokens: new Map([[`${id}:15`, token]]) },
};
async function compile(changedSource, extra = {}) {
  if (!changedSource)
    return compileLatestDirectEffect({
      id,
      definitionBytes,
      manifest,
      manifestBytes,
      kernels,
      ...extra,
    });
  const record = structuredClone(authored);
  record.definition.complexEmitterDefinitionData[15] = changedSource;
  const bytes = new TextEncoder().encode(JSON.stringify(record));
  const changedManifest = structuredClone(manifest);
  changedManifest.definitions[id].sha256 = await sha256(bytes);
  const manifestContent = new TextEncoder().encode(
    JSON.stringify(changedManifest),
  );
  return compileLatestDirectEffect({
    id,
    definitionBytes: bytes,
    manifest: changedManifest,
    manifestBytes: manifestContent,
    kernels,
    ...extra,
  });
}

test("installed mesh remains omitted without prepared capability and material", async () => {
  const compiled = await compile();
  expect(compiled.emitters.some((emitter) => emitter.index === 15)).toBe(false);
  expect(
    compiled.unsupported.find((emitter) => emitter.index === 15).reasons,
  ).toEqual([
    "field:uvScale",
    "mesh:capability-package-unprepared",
    "primitive:VfxPrimitiveMesh",
    "primitive-properties",
  ]);
  const capability = meshPrograms.compile(
    authored.definition.complexEmitterDefinitionData[15],
  );
  expect(capability.status).toBe("prepared-static-mesh-primitive-program");
  expect(capability.sharedParticleAdmissionRequired).toBe(true);
  expect(capability.materialAdmissionRequired).toBe(true);
});

test("installed mesh compiles only with both owned approvals and preserves original source", async () => {
  const missingMaterial = await compile(undefined, { meshPrograms });
  expect(
    missingMaterial.unsupported.find((emitter) => emitter.index === 15).reasons,
  ).toEqual(["material:static-mesh-individual-selection-unprepared"]);
  const compiled = await compile(undefined, owned);
  const mesh = compiled.emitters.find((emitter) => emitter.index === 15);
  expect(mesh.primitive).toBe("static-mesh");
  expect(mesh.source.primitive).toEqual(
    authored.definition.complexEmitterDefinitionData[15].primitive,
  );
  expect(mesh.source.uvScale).toEqual(
    authored.definition.complexEmitterDefinitionData[15].uvScale,
  );
  expect(mesh.meshMaterialSelection.sourceDefinitionSha256).toBe(ref.sha256);
  expect(mesh.meshMaterialSelection.vertexSha256).toBe(
    mesh.meshProgram.resource.vertices.sha256,
  );
  expect(mesh.meshProgram.worldUniformOrder).toBe("post-1916f70");
  expect(mesh.placementRequirements.rootBasis).toBe(true);
});

test("forged capability factories and cloned material tokens fail closed", async () => {
  await expect(
    compile(undefined, { meshPrograms: { ...meshPrograms } }),
  ).rejects.toThrow("Owned static mesh capability");
  await expect(
    compile(undefined, {
      ...owned,
      meshMaterialAdmission: {
        materials: { ...materials },
        tokens: owned.meshMaterialAdmission.tokens,
      },
    }),
  ).rejects.toThrow("Owned static mesh material");
  await expect(
    compile(undefined, {
      ...owned,
      meshMaterialAdmission: {
        materials,
        tokens: new Map([[`${id}:15`, structuredClone(token)]]),
      },
    }),
  ).rejects.toThrow("Owned static mesh material handle");
});

test("shared particle checks still explain invalid lifetime and binding with real mesh source", async () => {
  const source = structuredClone(
    authored.definition.complexEmitterDefinitionData[15],
  );
  source.particleLifetime.constantValue = 0;
  source.bindWeight.constantValue = 0.5;
  const compiled = await compile(source, { meshPrograms }),
    reasons = compiled.unsupported.find(
      (emitter) => emitter.index === 15,
    ).reasons;
  expect(reasons).toContain("birth:lifetime");
  expect(reasons).toContain("binding:nonconstant-weight");
  expect(compiled.emitters.some((emitter) => emitter.index === 15)).toBe(false);
  // Mesh capability approval alone never substitutes for these common checks.
  expect(meshPrograms.compile(source).sharedParticleAdmissionRequired).toBe(
    true,
  );
});

test("mesh admission preserves shared shape/motion gates and exact material source identity", async () => {
  const shape = structuredClone(
    authored.definition.complexEmitterDefinitionData[15],
  );
  shape.SpawnShape = { __type: "VfxShapeLegacy" };
  const shapeResult = await compile(shape, { meshPrograms });
  expect(
    shapeResult.unsupported.find((emitter) => emitter.index === 15).reasons,
  ).toContain("shape:VfxShapeLegacy");
  const motion = structuredClone(
    authored.definition.complexEmitterDefinitionData[15],
  );
  motion.birthVelocity = { __type: "ValueVector3", constantValue: [1, 0, 0] };
  motion.isSingleParticle = 0;
  const motionResult = await compile(motion, { meshPrograms });
  expect(
    motionResult.unsupported.find((emitter) => emitter.index === 15).reasons,
  ).toContain("motion:velocity-continuous-birth-clock");
  const foreign = structuredClone(
    authored.definition.complexEmitterDefinitionData[15],
  );
  foreign.emitterName = "changed source content";
  await expect(compile(foreign, owned)).rejects.toThrow(
    "differs from source/program",
  );
});

test("serialized mesh programs reject source/resource/material and placement mutations", async () => {
  const definition = await compile(undefined, owned),
    mesh = definition.emitters.find((emitter) => emitter.index === 15);
  expect(
    validateDirectStaticMeshProgram(mesh, {
      id,
      definitionHash: ref.sha256,
      index: 15,
    }),
  ).toBe(mesh.meshProgram);
  for (const mutate of [
    (v) => {
      v.meshProgram.uv.baseMatrix[0] = 1;
    },
    (v) => {
      v.source.uvScale.constantValue[0] = 1;
    },
    (v) => {
      v.meshProgram.resourcePackageSha256 = "0".repeat(64);
    },
    (v) => {
      v.meshProgram.resource.vertices.sha256 = "0".repeat(64);
    },
    (v) => {
      v.meshProgram.resourceFields.offset40 = [, 0, 0];
    },
    (v) => {
      v.meshProgram.resourceFields.offset40[0] = 1;
    },
    (v) => {
      v.meshMaterialSelection.emitterIndex = 14;
    },
    (v) => {
      v.meshMaterialSelection.policy.instanceDraw = 1;
    },
    (v) => {
      v.meshMaterialSelection.policy.shaderPair.vertex = "0".repeat(64);
    },
    (v) => {
      v.meshMaterialSelection.policy.inactiveResource.payloadRecovered = true;
    },
    (v) => {
      v.placementRequirements.rootBasis = false;
    },
    (v) => {
      delete v.meshProgram;
    },
  ]) {
    const altered = structuredClone(mesh);
    mutate(altered);
    expect(() =>
      validateDirectStaticMeshProgram(altered, {
        id,
        definitionHash: ref.sha256,
        index: 15,
      }),
    ).toThrow();
  }
  expect(() =>
    validateDirectStaticMeshProgram(mesh, {
      id: "other",
      definitionHash: ref.sha256,
    }),
  ).toThrow("material identity");
  expect(() =>
    validateDirectStaticMeshProgram({ ...mesh, primitive: "arbitrary-quad" }),
  ).toThrow("Unexpected");
  expect(
    validateDirectStaticMeshProgram({ primitive: "camera-quad" }),
  ).toBeNull();
});
