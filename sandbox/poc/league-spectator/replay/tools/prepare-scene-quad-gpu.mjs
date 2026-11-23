// Controlled quad-component packing for an explicit scene authority. This does
// not assert actual pass/predicate values or replace unprepared native textures.
import path from "node:path";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { createSceneVfxMaterialBindings } from "../scene-vfx-material-bindings.mjs";
import {
  prepareNativeParticleGpuBinding,
  nativeParticleGpuOmissions,
} from "../latest-native-particle-gpu-binding.mjs";
import {
  assertSelectedMaterialParameterInputSpans,
  deriveAuthoredSelectedMaterialSourceVectors,
} from "../latest-selected-material-parameter-inputs.mjs";
import { sameDirectCompiledData as same } from "../latest-direct-compiled-restore.mjs";
import { createSceneColdDefaultTextures } from "../scene-cold-default-textures.mjs";
import { resolveSceneColdMaterialBindings } from "../scene-cold-material-bindings.mjs";
import { createSceneAllVisionFog } from "../scene-all-vision-fog.mjs";
const [
  sourceArg,
  sceneArg,
  effectsArg,
  nativeArg,
  materialArg,
  environmentArg,
  cacheArg,
  defaultsArg,
  fogArg,
] = process.argv.slice(2);
if (!cacheArg)
  throw Error(
    "Usage: bun prepare-scene-quad-gpu.mjs <approved-cache> <scene-root> <effects-root> <native-authority> <material-authority> <controlled-environment.json> <archive-cache> [<original-cold-default-textures-root> [<original-all-vision-fog-root>]]",
  );
const { sourceCache, out } = await createStaticPreparationOutput(
  sourceArg,
  cacheArg,
  { prefix: "scene-quad-gpu-", directory: "scene-quad-gpu" },
);
const roots = {
    build: path.join(sourceCache, "public"),
    scene: path.resolve(sceneArg),
    effects: path.resolve(effectsArg),
    native: path.resolve(nativeArg),
    material: path.resolve(materialArg),
    ...(defaultsArg ? { defaults: path.resolve(defaultsArg) } : {}),
    ...(fogArg ? { fog: path.resolve(fogArg) } : {}),
  },
  decode = (bytes) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  dependencies = new Map(),
  files = [],
  sources = {};
for (const file of [
  "prepare-scene-quad-gpu.mjs",
  "../scene-vfx-material-bindings.mjs",
  "../scene-vfx-material-contract.mjs",
  "../scene-vfx-material-data.mjs",
  "../latest-native-particle-gpu-binding.mjs",
  "../latest-selected-material-parameter-inputs.mjs",
  "../scene-cold-default-textures.mjs",
  "../scene-cold-material-bindings.mjs",
  "../scene-all-vision-fog.mjs",
  "../structural-comparison.mjs",
])
  sources[file] = sha(await Bun.file(new URL(file, import.meta.url)).bytes());
async function read(authority, file) {
  const root = roots[authority],
    source = path.resolve(root, file);
  if (!source.startsWith(root + path.sep))
    throw Error("Scene GPU input escaped selected authority");
  const bytes = await Bun.file(source).bytes();
  dependencies.set(`${authority}:${file}`, {
    authority,
    file,
    bytes: bytes.length,
    sha256: sha(bytes),
  });
  return bytes;
}
const baseProfileBytes = await read(
    "build",
    "decoder-16.21-macos/profile.json",
  ),
  imageBytes = await read("build", "decoder-16.21-macos/image.bin"),
  sceneBytes = await read("scene", "manifest.json"),
  effectsManifestBytes = await read("effects", "manifest.json"),
  nativeAuthorityBytes = await read("native", "manifest.json"),
  materialAuthorityBytes = await read("material", "manifest.json"),
  effects = decode(effectsManifestBytes),
  native = decode(nativeAuthorityBytes),
  materials = decode(materialAuthorityBytes),
  environmentBytes = await Bun.file(environmentArg).bytes(),
  control = decode(environmentBytes);
if (
  Object.keys(control).sort().join("|") !==
    "featuresEnabled|graphics29c|graphics34b|pass|resourceMask|systemFogMode" ||
  control.resourceMask !== "original-defined-pointers" ||
  control.pass !== 0 ||
  control.featuresEnabled !== true ||
  ![0, 1].includes(control.systemFogMode) ||
  control.graphics34b !== false ||
  control.graphics29c !== 0
)
  throw Error(
    "Explicit observed baseline control environment required; live scene predicate selection is unprepared",
  );
const api = await createSceneVfxMaterialBindings({
    baseProfileBytes,
    imageBytes,
    sceneBytes,
    effectsManifestBytes,
    nativeAuthorityBytes,
    materialAuthorityBytes,
    readResource: ({ authority, file }) => read(authority, file),
  }),
  shaderPackageBytes = await read("build", "latest-shaders/package.json"),
  shaderPackage = decode(shaderPackageBytes),
  pairsBytes = await Bun.file(
    path.join(sourceCache, "research/latest-shaders/pairs.json"),
  ).bytes(),
  pairs = decode(pairsBytes);
const defaultsBytes = defaultsArg
    ? await read("defaults", "manifest.json")
    : null,
  defaults = defaultsBytes
    ? await createSceneColdDefaultTextures({
        manifestBytes: defaultsBytes,
        readResource: (file) => read("defaults", file),
      })
    : null;
const fogBytes = fogArg ? await read("fog", "manifest.json") : null,
  allVisionFog = fogBytes
    ? await createSceneAllVisionFog({
        manifestBytes: fogBytes,
        readResource: (file) => read("fog", file),
        sceneBytes,
        worldBytes: await read("scene", "world.json"),
        baseProfileBytes,
        imageBytes,
        perspective: "all",
      })
    : null;
if (allVisionFog && control.systemFogMode !== 0)
  throw Error(
    "All-vision material authority preserves original source fog mode0",
  );
if (pairs.shaderPackageSha256 !== sha(shaderPackageBytes))
  throw Error("Original shader package/pair identities differ");
const shaderInputs = {},
  stages = new Map(),
  records = new Map(),
  emitters = [],
  omitted = [],
  unsupportedSimpleEmitters = [];
function omit(row, reasons) {
  omitted.push({
    effectId: row.effectId,
    emitterIndex: row.emitterIndex,
    kind: row.kind ?? "complex",
    reasons,
  });
}
const raw = async (file) => {
  const relative = file.startsWith("assets/") ? file.slice(7) : null;
  if (!relative) throw Error("Explicit scene shader/texture resource required");
  const authority = relative.startsWith("latest-effects/")
      ? "effects"
      : "build",
    selectedFile =
      authority === "effects"
        ? relative.slice("latest-effects/".length)
        : relative,
    bytes = await read(authority, selectedFile);
  shaderInputs[file] = sha(bytes);
  return bytes;
};
for (const body of native.emitters) {
  if (body.kind !== "complex") {
    unsupportedSimpleEmitters.push({
      effectId: body.effectId,
      emitterIndex: body.emitterIndex,
      kind: body.kind,
      status: body.status,
      reason: body.reason,
    });
    continue;
  }
  if (body.status !== "native-bound-quad-prepared") {
    omit(body, [
      `native-runtime:${body.status}:${body.reason ?? "unprepared"}`,
    ]);
    continue;
  }
  let record = records.get(body.effectId);
  if (!record) {
    const ref = effects.definitions[body.effectId],
      bytes = await read("effects", ref.file);
    if (sha(bytes) !== ref.sha256)
      throw Error("Original scene material definition changed");
    record = decode(bytes);
    records.set(body.effectId, record);
  }
  const source =
      record.definition.complexEmitterDefinitionData[body.emitterIndex],
    row = materials.emitters.find(
      (row) =>
        row.effectId === body.effectId &&
        row.emitterIndex === body.emitterIndex,
    );
  if (!row) throw Error("Native material eligible graph missing");
  if (row.status !== "original-material-selector-observed") {
    omit(body, [row.status]);
    continue;
  }
  const reasons = nativeParticleGpuOmissions(
    source,
    row.erosionParameters.length > 0,
    false,
  );
  for (const key of [source.texture, source.textureMult?.textureMult])
    if (
      key &&
      (!effects.assets[key.toLowerCase()] ||
        effects.assets[key.toLowerCase()].status !== "prepared" ||
        effects.assets[key.toLowerCase()].kind !== "texture")
    )
      reasons.push(`unprepared-original-texture:${key}`);
  if (reasons.length) {
    omit(body, reasons);
    continue;
  }
  const graph = decode(await read("native", body.resources.boundQuad.file));
  assertSelectedMaterialParameterInputSpans(source, graph);
  const derived = deriveAuthoredSelectedMaterialSourceVectors(source);
  for (const key of [
    "parameters",
    "samplers",
    "erosionAtSuppliedDrive",
    "erosionParameters",
  ])
    if (!same(derived[key], row[key]))
      throw Error("Original material numeric source differs: " + key);
  const environment = { ...control, resourceMask: row.definedObjectMask },
    material = await api.describe(
      body.effectId,
      body.emitterIndex,
      environment,
      { erosionDrive: null },
    ),
    family = shaderPackage.pairs.find(
      (pair) =>
        pair.vertex === material.vertex.toLowerCase() &&
        pair.pixel === material.pixel.toLowerCase(),
    );
  if (!family) {
    omit(body, [
      `unprepared-original-shader-family:${material.vertex}:${material.pixel}`,
    ]);
    continue;
  }
  const reference = {
    ...graph,
    sha256: body.resources.boundQuad.sha256,
    environment,
    selection: { vertex: material.vertex, pixel: material.pixel },
    renderState: {
      bytesHex: material.renderStateHex,
      defines: material.defines,
      uniforms: [],
    },
    parameters: [...material.parameters].map(([name, value]) => ({
      name,
      bytesHex: Buffer.from(
        value.buffer,
        value.byteOffset,
        value.byteLength,
      ).toString("hex"),
    })),
    samplers: material.samplers,
    needsErosionDrive: false,
  };
  const result = await prepareNativeParticleGpuBinding(reference, record, {
    effects,
    shaderPackage,
    pairs,
    assets: "assets",
    read: async (file) => decode(await raw(file)),
    raw,
    sha,
    inputs: shaderInputs,
    stages,
    colorBindings: new Map(),
    allVisionFog,
  });
  if (result.omitted) {
    omit(body, result.omitted.reasons);
    continue;
  }
  const resolved = resolveSceneColdMaterialBindings(result.binding, defaults, {
    emitter: source,
    nativeSamplers: material.samplers,
    allVisionFog,
  });
  if (resolved.omitted) {
    omit(body, resolved.omitted.reasons);
    continue;
  }
  emitters.push(resolved.binding);
}
async function write(file, bytes) {
  await Bun.write(path.join(out, file), bytes);
  files.push({ file, bytes: bytes.length, sha256: sha(bytes) });
}
await write("environment.json", environmentBytes);
await write("shader-pairs.json", pairsBytes);
const packageValue = {
  schema: allVisionFog ? 3 : defaults ? 2 : 1,
  kind: "prepared-scene-controlled-quad-gpu-bindings",
  build: native.build,
  protocol: native.protocol,
  sceneManifestSha256: sha(sceneBytes),
  effectsManifestSha256: sha(effectsManifestBytes),
  nativeAuthoritySha256: sha(nativeAuthorityBytes),
  nativeMaterialAuthoritySha256: sha(materialAuthorityBytes),
  shaderPackageSha256: sha(shaderPackageBytes),
  controlledEnvironmentSha256: sha(environmentBytes),
  originalColdDefaultAuthoritySha256: defaultsBytes ? sha(defaultsBytes) : null,
  ...(allVisionFog
    ? { originalAllVisionFogAuthoritySha256: sha(fogBytes), perspective: "all" }
    : {}),
  emitters,
  omitted,
  unsupportedSimpleEmitters,
  counts: {
    emitters: emitters.length,
    omitted: omitted.length,
    unsupportedSimpleEmitters: unsupportedSimpleEmitters.length,
    shaderStages: stages.size,
  },
  scope: {
    originalMaterialSelectors: true,
    controlledEnvironment: true,
    actualScenePredicates: false,
    defaultTextureSubstitutions: false,
    originalColdDefaultsOnly: defaults !== null,
    unsupportedFamiliesPrepared: false,
    shaderSubmission: false,
    nativeRendererAdmitted: false,
  },
};
await write(
  "package.json",
  new TextEncoder().encode(JSON.stringify(packageValue)),
);
for (const [file, digest] of Object.entries(sources))
  if (sha(await Bun.file(new URL(file, import.meta.url)).bytes()) !== digest)
    throw Error("Scene GPU compiler source changed");
for (const entry of dependencies.values())
  if (
    sha(
      await Bun.file(path.join(roots[entry.authority], entry.file)).bytes(),
    ) !== entry.sha256
  )
    throw Error("Scene GPU source dependency changed");
if (
  sha(await Bun.file(environmentArg).bytes()) !== sha(environmentBytes) ||
  sha(
    await Bun.file(
      path.join(sourceCache, "research/latest-shaders/pairs.json"),
    ).bytes(),
  ) !== sha(pairsBytes)
)
  throw Error("Scene GPU controlled environment/shader pairs changed");
const manifest = {
  schema: allVisionFog ? 3 : defaults ? 2 : 1,
  kind: "prepared-scene-controlled-material-package",
  build: native.build,
  protocol: native.protocol,
  sceneManifestSha256: sha(sceneBytes),
  effectsManifestSha256: sha(effectsManifestBytes),
  nativeAuthoritySha256: sha(nativeAuthorityBytes),
  nativeMaterialAuthoritySha256: sha(materialAuthorityBytes),
  shaderPackageSha256: sha(shaderPackageBytes),
  originalColdDefaultAuthoritySha256: defaultsBytes ? sha(defaultsBytes) : null,
  ...(allVisionFog
    ? { originalAllVisionFogAuthoritySha256: sha(fogBytes), perspective: "all" }
    : {}),
  roles: {
    quadGpu: "package.json",
    shaderPairs: "shader-pairs.json",
    sceneMaterialEnvironment: "environment.json",
  },
  files,
  dependencies: [...dependencies.values()],
  sources,
  nativeSpectatorAdmitted: false,
};
await Bun.write(path.join(out, "manifest.json"), JSON.stringify(manifest));
console.log(
  JSON.stringify({
    output: out,
    prepared: emitters.length,
    omitted: omitted.length,
    stages: stages.size,
    nativeSpectatorAdmitted: false,
  }),
);
