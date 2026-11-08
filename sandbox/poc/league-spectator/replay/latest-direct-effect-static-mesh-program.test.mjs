import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { createLatestDirectStaticMeshPrograms } from "./latest-direct-effect-static-mesh-program.mjs";
import { sha256 } from "./structural-comparison.mjs";

const cache = resolve(".cache/replay-spike"),
  directory = `${cache}/public/latest-direct-static-mesh-resources`;
const packageBytes = await Bun.file(`${directory}/package.json`).bytes();
const profile = await Bun.file(
  `${cache}/public/decoder-16.21-macos/profile.json`,
).json();
const effectsManifestBytes = await Bun.file(
  `${cache}/public/latest-effects/manifest.json`,
).bytes();
const manifest = JSON.parse(new TextDecoder().decode(effectsManifestBytes));
const definition = await Bun.file(
  `${cache}/public/latest-effects/${manifest.definitions["champions/hecarim/0/e57b8289"].file}`,
).json();
const authored = definition.definition.complexEmitterDefinitionData[15];
const options = {
  profile,
  packageBytes,
  expectedPackageSha256: await sha256(packageBytes),
  effectsManifestBytes,
  loadBytes: (file) => Bun.file(`${directory}/${file}`).bytes(),
};
const resources = await createLatestDirectStaticMeshPrograms(options);

test("installed static mesh program preserves exact resources and partial admission boundaries", () => {
  const source = structuredClone(authored),
    result = resources.compile(source);
  expect(result.status).toBe("prepared-static-mesh-primitive-program");
  expect(result.sharedParticleAdmissionRequired).toBe(true);
  expect(result.materialAdmissionRequired).toBe(true);
  expect(result.program.resource.source.sha256).toBe(
    manifest.assets[source.primitive.mMesh.mSimpleMeshName.toLowerCase()]
      .sourceSha256,
  );
  expect(result.program.resource.vertexStride).toBe(36);
  expect(result.program.resource.triangles).toBe(160);
  expect(result.program.uv.baseMatrix).toEqual([2, 0, 0, 1, -0.5, 0]);
  expect(result.program.worldUniformOrder).toBe("post-1916f70");
  expect(result.program.placementRequirements.rootBasis).toBe(true);
  source.uvScale.constantValue[0] = 999;
  expect(result.program.source.uvScale.constantValue).toEqual([2, 1]);
  const inventory = resources.inventory();
  inventory[0].vertices.sha256 = "0".repeat(64);
  expect(resources.inventory()[0].vertices.sha256).not.toBe("0".repeat(64));
});

test("mesh capability compilation is independent of champion identity and owns static geometry", () => {
  const source = structuredClone(authored),
    alternate = resources
      .inventory()
      .find(
        (entry) =>
          entry.path !== authored.primitive.mMesh.mSimpleMeshName.toLowerCase(),
      );
  source.primitive.mMesh.mSimpleMeshName = alternate.path.toUpperCase();
  const result = resources.compile(source);
  expect(result.status).toBe("prepared-static-mesh-primitive-program");
  expect(result.program.resource.path).toBe(alternate.path);
  const geometry = resources.geometry(alternate.path);
  expect(geometry.positions.length).toBe(alternate.triangles * 9);
  const first = geometry.positions[0];
  geometry.positions[0] = 999;
  expect(resources.geometry(alternate.path).positions[0]).toBe(first);
});

test("unknown mesh providers and authored UV changes remain precise omissions", () => {
  const bone = structuredClone(authored);
  bone.primitive.mMesh.mMeshName = "unknown.skn";
  expect(resources.compile(bone).reasons).toContain(
    "mesh:definition-bone-facing-animated-or-properties",
  );
  const mult = structuredClone(authored);
  mult.textureMult = {};
  expect(resources.compile(mult).reasons).toContain(
    "mesh:unsupported-source:textureMult",
  );
  const dynamic = structuredClone(authored);
  dynamic.uvScale.dynamics = {};
  expect(resources.compile(dynamic).reasons).toContain(
    "mesh:constant-centered-base-uv-scale",
  );
  const sparse = structuredClone(authored);
  sparse.uvScale.constantValue = [, 1];
  expect(resources.compile(sparse).status).toBe(
    "unsupported-static-mesh-component",
  );
  const missing = structuredClone(authored);
  missing.primitive.mMesh.mSimpleMeshName = "ASSETS/Unknown/not-prepared.scb";
  expect(resources.compile(missing).reasons).toEqual([
    "mesh:unprepared-static-resource:assets/unknown/not-prepared.scb",
  ]);
});

test("resource factory rejects corrupt bytes and incompatible package content", async () => {
  await expect(
    createLatestDirectStaticMeshPrograms({
      ...options,
      expectedPackageSha256: "0".repeat(64),
    }),
  ).rejects.toThrow("Pinned");
  await expect(
    createLatestDirectStaticMeshPrograms({
      ...options,
      profile: { ...profile, clientVersion: "other" },
    }),
  ).rejects.toThrow("Exact-build");
  await expect(
    createLatestDirectStaticMeshPrograms({
      ...options,
      loadBytes: async (file) => {
        const bytes = await options.loadBytes(file);
        bytes[0] ^= 1;
        return bytes;
      },
    }),
  ).rejects.toThrow("content hash");
  const first = resources.inventory()[0];
  for (const [key, reason] of [
    ["resourceHeader", "resourceHeader"],
    ["vertices", "vertices"],
  ]) {
    await expect(
      createLatestDirectStaticMeshPrograms({
        ...options,
        loadBytes: async (file) => {
          const bytes = await options.loadBytes(file);
          if (file === first[key].file) bytes[0] ^= 1;
          return bytes;
        },
      }),
    ).rejects.toThrow(reason);
  }
  const duplicate = JSON.parse(new TextDecoder().decode(packageBytes));
  duplicate.resources.push(structuredClone(duplicate.resources[0]));
  const duplicateBytes = new TextEncoder().encode(JSON.stringify(duplicate));
  await expect(
    createLatestDirectStaticMeshPrograms({
      ...options,
      packageBytes: duplicateBytes,
      expectedPackageSha256: await sha256(duplicateBytes),
    }),
  ).rejects.toThrow("duplicate");
});
