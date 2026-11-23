// Extend a closed scene plan with only the GPU producer's consumed resources.
// The source inventories stay immutable; this command writes a private config.
import assert from "node:assert/strict";
import { resolve, posix } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { sceneAnimationFilePath } from "../scene-animation-authority.mjs";
import { validateSelectedStaticSourcePlan } from "./selected-static-sources.mjs";
import { createSceneAllVisionFog } from "../scene-all-vision-fog.mjs";

const [
  inputArg,
  nativeArg,
  materialArg,
  gpuArg,
  outputArg,
  defaultsArg,
  fogArg,
] = process.argv.slice(2);
if (!outputArg || ![7, 8, 9].includes(process.argv.length))
  throw Error(
    "Usage: bun extend-selected-scene-material-config.mjs <scene-config.json> <native-root> <material-root> <GPU-root> <output-config.json> [explicit-cold-defaults-root] [explicit-all-vision-fog-root]",
  );
const inputBytes = await Bun.file(resolve(inputArg)).bytes(),
  config = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(inputBytes),
  );
assert.equal(Object.keys(config).sort().join("|"), "plan|roles|roots");
validateSelectedStaticSourcePlan(config.plan);
const newRoots = {
    sceneVfxNative: resolve(nativeArg),
    sceneVfxMaterial: resolve(materialArg),
    sceneQuadGpu: resolve(gpuArg),
    ...(defaultsArg ? { sceneColdDefaults: resolve(defaultsArg) } : {}),
    ...(fogArg ? { sceneAllVisionFog: resolve(fogArg) } : {}),
  },
  prefixes = {
    sceneVfxNative: "scene-native-vfx",
    sceneVfxMaterial: "scene-native-materials",
    sceneQuadGpu: "scene-quad-gpu",
    sceneColdDefaults: "scene-cold-defaults",
    sceneAllVisionFog: "scene-all-vision-fog",
  },
  manifests = {},
  receipts = new Map();
async function raw(authority, file) {
  sceneAnimationFilePath(file);
  const path = resolve(newRoots[authority] ?? config.roots[authority], file),
    bytes = await Bun.file(path).bytes(),
    sha = await sha256(bytes);
  const prior = receipts.get(path);
  assert(
    !prior || prior.sha256 === sha,
    "Material plan input changed: " + path,
  );
  receipts.set(path, { bytes: bytes.length, sha256: sha });
  return bytes;
}
const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
async function add(authority, file, expected, target) {
  sceneAnimationFilePath(target);
  const bytes = await raw(authority, file),
    ref = {
      source: { authority, file },
      sha256: await sha256(bytes),
      bytes: bytes.length,
    };
  assert.equal(
    ref.sha256,
    expected.sha256,
    "Declared source hash: " + authority + ":" + file,
  );
  assert.equal(
    ref.bytes,
    expected.bytes,
    "Declared source bytes: " + authority + ":" + file,
  );
  if (Object.hasOwn(config.plan.files, target))
    assert.deepEqual(
      config.plan.files[target],
      ref,
      "Conflicting source target: " + target,
    );
  else config.plan.files[target] = ref;
  return ref;
}
for (const [authority, root] of Object.entries(newRoots)) {
  assert(
    !Object.hasOwn(config.plan.sources, authority),
    "New material authority already exists",
  );
  const bytes = await raw(authority, "manifest.json"),
    identity = {
      file: "manifest.json",
      bytes: bytes.length,
      sha256: await sha256(bytes),
    };
  manifests[authority] = decode(bytes);
  config.roots[authority] = root;
  config.plan.sources[authority] = { kind: "prepared-scene-package", identity };
  await add(
    authority,
    identity.file,
    identity,
    prefixes[authority] + "/manifest.json",
  );
}
const gpu = manifests.sceneQuadGpu,
  native = manifests.sceneVfxNative,
  material = manifests.sceneVfxMaterial;
assert.equal(native.kind, "original-scene-vfx-composed-native-authority");
assert.equal(material.kind, "original-scene-vfx-composed-material-authority");
assert.equal(gpu.kind, "prepared-scene-controlled-material-package");
assert.equal(gpu.nativeSpectatorAdmitted, false);
assert([1, 2, 3].includes(gpu.schema), "Unknown controlled GPU package schema");
assert.equal(
  Boolean(defaultsArg),
  gpu.schema >= 2,
  "GPU schema2/3 requires its explicit cold-default authority; legacy packages cannot acquire one",
);
assert.equal(
  Boolean(fogArg),
  gpu.schema === 3,
  "GPU schema3 requires its explicit all-vision fog authority",
);
const ownedRole = (name) => {
  const ref = config.plan.files[config.roles[name]];
  assert(ref, "Explicit existing role required: " + name);
  return ref;
};
const profile = config.plan.sources.build.identity,
  scene = ownedRole("scene"),
  effects = ownedRole("effects");
for (const manifest of [native, material, gpu]) {
  assert.equal(manifest.build, "16.21.829.8620");
  assert.equal(manifest.protocol, "20e09df23c66b85e");
  assert.equal(manifest.sceneManifestSha256, scene.sha256);
  assert.equal(manifest.effectsManifestSha256, effects.sha256);
}
for (const manifest of [native, material]) {
  assert.equal(manifest.baseProfileSha256, profile.sha256);
  assert.equal(
    manifest.decoderImageSha256,
    config.plan.files["decoder-16.21-macos/image.bin"].sha256,
  );
  assert.equal(manifest.nativeSpectatorAdmitted, false);
}
assert.equal(
  gpu.nativeAuthoritySha256,
  config.plan.sources.sceneVfxNative.identity.sha256,
);
assert.equal(
  gpu.nativeMaterialAuthoritySha256,
  config.plan.sources.sceneVfxMaterial.identity.sha256,
);
if (defaultsArg) {
  const defaults = manifests.sceneColdDefaults;
  assert.equal(defaults.schema, 2);
  assert.equal(defaults.kind, "original-cold-material-default-textures");
  assert.equal(defaults.build, "16.21.829.8620");
  assert.equal(defaults.protocol, "20e09df23c66b85e");
  assert.equal(
    defaults.decoderImageSha256,
    config.plan.files["decoder-16.21-macos/image.bin"].sha256,
  );
  assert.equal(defaults.evidence.nativeRendererAdmitted, false);
  assert.equal(
    gpu.originalColdDefaultAuthoritySha256,
    config.plan.sources.sceneColdDefaults.identity.sha256,
  );
  assert(
    !Object.hasOwn(config.roles, "sceneColdDefaultTextures"),
    "Cannot replace an existing cold-default role",
  );
  config.roles.sceneColdDefaultTextures =
    prefixes.sceneColdDefaults + "/manifest.json";
}
if (fogArg) {
  assert.equal(gpu.perspective, "all");
  assert.equal(
    gpu.originalAllVisionFogAuthoritySha256,
    config.plan.sources.sceneAllVisionFog.identity.sha256,
  );
  const sceneBytes = await raw(scene.source.authority, scene.source.file),
    sceneData = decode(sceneBytes);
  sceneAnimationFilePath(sceneData.world);
  const worldPath = posix.join(
      posix.dirname(config.roles.scene),
      sceneData.world,
    ),
    world = config.plan.files[worldPath];
  assert(
    world,
    "Explicit closed selected world resource required for all-vision authority",
  );
  assert.deepEqual(world.source, {
    authority: scene.source.authority,
    file: posix.join(posix.dirname(scene.source.file), sceneData.world),
  });
  await createSceneAllVisionFog({
    manifestBytes: await raw("sceneAllVisionFog", "manifest.json"),
    readResource: (file) => raw("sceneAllVisionFog", file),
    sceneBytes,
    worldBytes: await raw(world.source.authority, world.source.file),
    baseProfileBytes: await raw("build", profile.file),
    imageBytes: await raw("build", "decoder-16.21-macos/image.bin"),
    perspective: "all",
  });
  assert(
    !Object.hasOwn(config.roles, "sceneAllVisionFog"),
    "Cannot replace an existing all-vision fog role",
  );
  config.roles.sceneAllVisionFog =
    prefixes.sceneAllVisionFog + "/manifest.json";
}
const selections = {
  build: { authority: "build", sourcePrefix: "", targetPrefix: "" },
  scene: {
    authority: scene.source.authority,
    sourcePrefix: posix.dirname(scene.source.file),
    targetPrefix: posix.dirname(config.roles.scene),
  },
  effects: {
    authority: effects.source.authority,
    sourcePrefix: posix.dirname(effects.source.file),
    targetPrefix: posix.dirname(config.roles.effects),
  },
  native: {
    authority: "sceneVfxNative",
    sourcePrefix: "",
    targetPrefix: prefixes.sceneVfxNative,
  },
  material: {
    authority: "sceneVfxMaterial",
    sourcePrefix: "",
    targetPrefix: prefixes.sceneVfxMaterial,
  },
  ...(defaultsArg
    ? {
        defaults: {
          authority: "sceneColdDefaults",
          sourcePrefix: "",
          targetPrefix: prefixes.sceneColdDefaults,
        },
      }
    : {}),
  ...(fogArg
    ? {
        fog: {
          authority: "sceneAllVisionFog",
          sourcePrefix: "",
          targetPrefix: prefixes.sceneAllVisionFog,
        },
      }
    : {}),
};
const inventories = Object.fromEntries(
  [
    "native",
    "material",
    ...(defaultsArg ? ["defaults"] : []),
    ...(fogArg ? ["fog"] : []),
  ].map((kind) => {
    const manifest =
      kind === "native"
        ? native
        : kind === "material"
          ? material
          : kind === "defaults"
            ? manifests.sceneColdDefaults
            : manifests.sceneAllVisionFog;
    return [kind, new Map(manifest.files.map((ref) => [ref.file, ref]))];
  }),
);
assert(Array.isArray(gpu.dependencies) && gpu.dependencies.length > 0);
const seen = new Set();
for (const dependency of gpu.dependencies) {
  assert.equal(
    Object.keys(dependency).sort().join("|"),
    "authority|bytes|file|sha256",
  );
  const selected = selections[dependency.authority];
  assert(selected, "Unknown explicit GPU dependency authority");
  const key = dependency.authority + ":" + dependency.file;
  assert(!seen.has(key), "Duplicate GPU dependency");
  seen.add(key);
  if (
    inventories[dependency.authority] &&
    dependency.file !== "manifest.json"
  ) {
    const declared = inventories[dependency.authority].get(dependency.file);
    assert(
      declared &&
        declared.sha256 === dependency.sha256 &&
        declared.bytes === dependency.bytes,
      "GPU dependency absent from its source authority: " + key,
    );
  }
  await add(
    selected.authority,
    posix.join(selected.sourcePrefix, dependency.file),
    dependency,
    posix.join(selected.targetPrefix, dependency.file),
  );
}
assert.equal(
  Object.keys(gpu.roles).sort().join("|"),
  "quadGpu|sceneMaterialEnvironment|shaderPairs",
);
const gpuFiles = new Map();
for (const ref of gpu.files) {
  assert(!gpuFiles.has(ref.file), "Duplicate GPU package file");
  gpuFiles.set(ref.file, ref);
  await add(
    "sceneQuadGpu",
    ref.file,
    ref,
    prefixes.sceneQuadGpu + "/" + ref.file,
  );
}
for (const [role, file] of Object.entries(gpu.roles)) {
  assert(gpuFiles.has(file), "Unowned GPU role: " + role);
  assert(
    !Object.hasOwn(config.roles, role),
    "Cannot replace an existing selected material role",
  );
  config.roles[role] = prefixes.sceneQuadGpu + "/" + file;
}
Object.assign(config.roles, {
  sceneVfxNativeAuthority: prefixes.sceneVfxNative + "/manifest.json",
  sceneVfxMaterialAuthority: prefixes.sceneVfxMaterial + "/manifest.json",
  selectedMaterials: prefixes.sceneQuadGpu + "/manifest.json",
  shaderPackage: "latest-shaders/package.json",
});
assert.equal(
  config.plan.files[config.roles.shaderPackage]?.sha256,
  gpu.shaderPackageSha256,
);
// Fixed original simulation programs consumed before material admission. These
// are build resources, separate from the selected scene's material producers.
for (const file of [
  "decoder-16.21-macos/vfx-values.json",
  "decoder-16.21-macos/vfx-birth.json",
  "decoder-16.21-macos/vfx-emission.json",
  "decoder-16.21-macos/vfx-samplers.json",
  "latest-world-descriptor-abi/package.json",
]) {
  const bytes = await raw("build", file);
  await add(
    "build",
    file,
    { bytes: bytes.length, sha256: await sha256(bytes) },
    file,
  );
}
validateSelectedStaticSourcePlan(config.plan);
assert.deepEqual(
  await Bun.file(resolve(inputArg)).bytes(),
  inputBytes,
  "Source configuration changed during extension",
);
for (const [file, ref] of receipts) {
  const bytes = await Bun.file(file).bytes();
  assert.equal(bytes.length, ref.bytes);
  assert.equal(
    await sha256(bytes),
    ref.sha256,
    "Changed material plan input: " + file,
  );
}
await Bun.write(resolve(outputArg), JSON.stringify(config, null, 2));
console.log(
  JSON.stringify({
    output: resolve(outputArg),
    authorities: Object.keys(config.plan.sources),
    files: Object.keys(config.plan.files).length,
    consumedGpuDependencies: gpu.dependencies.length,
    nativeSpectatorAdmitted: false,
  }),
);
