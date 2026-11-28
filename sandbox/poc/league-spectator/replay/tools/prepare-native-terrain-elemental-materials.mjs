import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

const profiles = {
  infernal: {
    metadata:
      "4a8b2432fa3316647092fee062ff84c198f5e085ea11860aa4584082f46a889d",
    mesh: "c0419c77f44277f4e0257c1dae73a24d355461b87640318231e351cba208c61c",
    materials:
      "c4ccce86cabfe3f8c47e39eb60588c35ff605c75dd118d0fd898f99f9eea1340",
  },
  mountain: {
    metadata:
      "5b3ed6a403893e7c4f38aab225aeadb96c625283956ffd010d649de9b80a3ccc",
    mesh: "437bb9c7fd9ea99268b0d2f6c417fe7af447c5645d451ee11daa7b9653d56636",
    materials:
      "12a412d96d08f7fec511f3a6547d3fb8f0dbd2fe1673592ff8567e1e0895d6fc",
  },
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function readPinned(path, digest) {
  const bytes = await readFile(path);
  assert.equal(sha256(bytes), digest, `Unreviewed elemental input: ${path}`);
  return bytes;
}

async function readProfile(profile, mapRoot, manifestPath) {
  const [metadata, mesh, manifest] = await Promise.all([
    readPinned(join(mapRoot, "map.json"), profile.metadata).then(JSON.parse),
    readPinned(join(mapRoot, "map.bin"), profile.mesh),
    readPinned(manifestPath, profile.materials).then(JSON.parse),
  ]);
  return { metadata, mesh, manifest, materialRoot: dirname(manifestPath) };
}

const [
  infernalMap,
  infernalMaterials,
  mountainMap,
  mountainMaterials,
  output,
  ...extra
] = process.argv.slice(2);
assert.ok(
  infernalMap &&
    infernalMaterials &&
    mountainMap &&
    mountainMaterials &&
    output &&
    extra.length === 0,
  "Supply the reviewed Infernal map and materials, Mountain map and materials, and a new private output directory",
);
const cache = resolve(".cache");
const root = resolve(output);
assert.ok(root.startsWith(cache + sep) && relative(cache, root) !== "");
const [infernal, mountain] = await Promise.all([
  readProfile(profiles.infernal, infernalMap, infernalMaterials),
  readProfile(profiles.mountain, mountainMap, mountainMaterials),
]);
const firstMountain = mountain.metadata.meshes.length - 12;
assert.deepEqual(
  mountain.metadata.meshes.slice(0, firstMountain),
  infernal.metadata.meshes.slice(0, -3),
);
const prefixLength = mountain.metadata.meshes[firstMountain].positionOffset;
assert.equal(infernal.metadata.meshes.at(-3).positionOffset, prefixLength);
assert.ok(
  infernal.mesh
    .subarray(0, prefixLength)
    .equals(mountain.mesh.subarray(0, prefixLength)),
);
const offset = infernal.mesh.length - prefixLength;
const meshes = [
  ...infernal.metadata.meshes,
  ...mountain.metadata.meshes.slice(firstMountain).map((mesh) => ({
    ...mesh,
    positionOffset: mesh.positionOffset + offset,
    uvOffset: mesh.uvOffset + offset,
    uv1Offset: mesh.uv1Offset + offset,
    indexOffset: mesh.indexOffset + offset,
  })),
];
const metadata = Buffer.from(JSON.stringify({ ...infernal.metadata, meshes }));
const mesh = Buffer.concat([
  infernal.mesh,
  mountain.mesh.subarray(prefixLength),
]);
assert.deepEqual(mountain.manifest.unsupported, infernal.manifest.unsupported);
const textures = new Map();
const bindings = {};
const grompDecals = new Set([
  "Maps/KitPieces/SRS/Base/Materials/Default/Earth_Order_GrompDecal_A_MAT",
  "Maps/KitPieces/SRS/Base/Materials/Default/Earth_Chaos_GrompDecal_A_MAT",
]);
for (const profile of [infernal, mountain]) {
  for (const [name, binding] of Object.entries(profile.manifest.bindings)) {
    if (Object.hasOwn(bindings, name)) {
      const expected = grompDecals.has(name)
        ? { ...binding, sourceAlphaBlend: true }
        : binding;
      assert.deepEqual(bindings[name], expected);
      continue;
    }
    bindings[name] = binding;
    assert.equal(binding.path, `textures/${binding.sha256}.png`);
    if (!textures.has(binding.path)) {
      const bytes = await readPinned(
        join(profile.materialRoot, binding.path),
        binding.sha256,
      );
      assert.equal(bytes.length, binding.bytes);
      textures.set(binding.path, bytes);
    }
  }
}
const faces = meshes.flatMap(({ submeshes }) => submeshes);
const totalTriangles = faces.reduce((sum, face) => sum + face.count / 3, 0);
const texturedTriangles = faces.reduce(
  (sum, { material, count }) =>
    sum + (Object.hasOwn(bindings, material) ? count / 3 : 0),
  0,
);
const manifest = {
  ...mountain.manifest,
  source: {
    ...mountain.manifest.source,
    mapMetadataSha256: sha256(metadata),
    mapMeshSha256: sha256(mesh),
  },
  coverage: {
    totalTriangles,
    texturedTriangles,
    unsupportedTriangles: totalTriangles - texturedTriangles,
    materials: new Set(faces.map(({ material }) => material)).size,
    texturedMaterials: Object.keys(bindings).length,
    textures: textures.size,
  },
  bindings,
};
const encodedManifest = JSON.stringify(manifest, null, 2) + "\n";
await mkdir(root);
await mkdir(join(root, "textures"));
for (const [path, bytes] of textures) await writeFile(join(root, path), bytes);
await Promise.all([
  writeFile(join(root, "map.json"), metadata),
  writeFile(join(root, "map.bin"), mesh),
  writeFile(join(root, "materials.json"), encodedManifest),
]);
console.log(
  JSON.stringify({
    ...manifest.source,
    materialsManifestSha256: sha256(encodedManifest),
    ...manifest.coverage,
  }),
);
