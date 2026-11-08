// Preserve complete native pass/variant bindings and actual verified texture
// planes. No renderer pass, scene resource or missing texture is synthesized.
import { resolve } from "node:path";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  directory = `${assets}/latest-parent-native-materials`,
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = await Bun.file(p).bytes();
    inputs[p] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  nativePath = `${cache}/research/parent-native-materials.json`,
  native = await read(nativePath),
  manifestPath = `${assets}/latest-effects/manifest.json`,
  manifest = await read(manifestPath),
  profile = await read(`${assets}/decoder-16.21-macos/profile.json`),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`),
  catalogPath = `${assets}/latest-ray-parent-caches/package.json`,
  catalog = await read(catalogPath),
  roots = {},
  textures = {},
  shaderStages = {},
  requiredScenes = {};
check(
  native.kind === "complete-native-parent-material-observations" &&
    !native.scope.partialSelection &&
    native.build === profile.clientVersion &&
    native.protocol === profile.protocolDigest &&
    native.decoderImageSha256 === sha(image) &&
    native.counts.roots === native.counts.capturedRoots &&
    manifest.build === native.build &&
    manifest.protocol === native.protocol &&
    catalog.build === native.build &&
    catalog.protocol === native.protocol &&
    catalog.caches.length === native.counts.roots,
  "Complete exact-build native material capture required",
);
for (const [name, digest] of Object.entries(native.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === digest,
    `Native material producer changed: ${name}`,
  );
for (const [path, digest] of Object.entries(native.inputs))
  check(
    sha(await raw(path)) === digest,
    `Native material input changed: ${path}`,
  );
for (const b of native.originalBlocks)
  check(
    sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Original material instructions changed",
  );
async function texture(record) {
  check(
    record.gpuBytesVerified &&
      [2, 0x15].includes(record.nativeFormat) &&
      ["2d", "cube", "array"].includes(record.kind) &&
      record.preparedLevels.length === record.mips,
    "Unverified native material texture",
  );
  for (const [mip, level] of record.preparedLevels.entries()) {
    check(
      level.length === record.layers,
      "Native material texture layer count differs",
    );
    for (const [layer, plane] of level.entries()) {
      check(
        plane.mip === mip &&
          plane.layer === layer &&
          plane.width === Math.max(1, record.width >> mip) &&
          plane.height === Math.max(1, record.height >> mip) &&
          plane.bytes === plane.width * plane.height * 4 &&
          /^planes\/[a-f0-9]{64}\.bin$/.test(plane.file),
        "Native material texture dimensions/path differ",
      );
      const bytes = await raw(`${directory}/${plane.file}`),
        readback = record.readbacks.find(
          (r) => r.mip === mip && r.layer === layer,
        );
      check(
        sha(bytes) === plane.sha256 &&
          bytes.length === plane.bytes &&
          readback.sha256 === plane.sha256 &&
          readback.bytes === plane.bytes,
        "Native material pixels differ from GPU readback",
      );
    }
  }
  const resource = {
      kind: record.kind,
      pixelFormat: record.nativeFormat === 2 ? "RGBA8" : "R32F",
      width: record.width,
      height: record.height,
      layers: record.layers,
      mips: record.mips,
      levels: record.preparedLevels,
      sourceNativeFormat: record.nativeFormat,
      nativeGpuReadbacks: record.readbacks,
      scope: {
        gpuBytesCompared: true,
        generatedMips: false,
        sourceMipCoverage:
          "all native device uploads; installed TEX registration currently supplies mip0",
      },
    },
    id = sha(JSON.stringify(resource));
  textures[id] ??= resource;
  return id;
}
async function shader(c, program, stage, path) {
  const candidates = Object.values(c.shaders).filter(
    (s) => s.glHandle === program[stage],
  );
  check(candidates.length === 1, "Native program stage is absent or ambiguous");
  const observed = candidates[0],
    ref = observed.translation;
  check(
    observed.compiled &&
      observed.stage === stage &&
      observed.path.toLowerCase() === path.toLowerCase(),
    "Native material path and compiled shader disagree",
  );
  const bytes = await raw(`${assets}/latest-shaders/${ref.file}`);
  check(
    sha(bytes) === ref.sha256 && bytes.length === ref.bytes,
    "Native material translated shader changed",
  );
  const translation = JSON.parse(new TextDecoder().decode(bytes));
  check(
    ref.stage === stage &&
      typeof translation.glsl === "string" &&
      translation.glsl.startsWith("#version 300 es\n"),
    "Native material shader translation stage differs",
  );
  shaderStages[ref.sha256] = ref;
  return {
    ...ref,
    path: observed.path,
    defines: observed.defines,
    permutationDefines: observed.permutationDefines,
    permutationHash: observed.permutationHash,
    recordId: observed.recordId,
  };
}
let actors = 0,
  passRows = 0,
  variants = 0;
for (const c of native.cases) {
  check(
    c.status === "complete-native-materials-captured" &&
      c.passes.lookupReadOnly &&
      manifest.definitions[c.effectId],
    "Uncaptured or undeclared native material root",
  );
  const ref = manifest.definitions[c.effectId],
    definition = await read(`${assets}/latest-effects/${ref.file}`);
  check(
    inputs[`${assets}/latest-effects/${ref.file}`] === ref.sha256,
    "Native material complete definition changed",
  );
  const rootActors = {};
  for (const actor of c.passes.actors) {
    const owned = c.ownership.actors.find(
      (a) => a.emitterIndex === actor.emitterIndex,
    );
    check(
      owned?.kind === "complex" &&
        owned.link === actor.link &&
        !Object.hasOwn(rootActors, actor.emitterIndex),
      "Native material actor ownership differs",
    );
    const rows = [];
    for (const row of actor.rows) {
      const values = [];
      for (const variant of row.variants) {
        const pipeline = c.pipelines[variant.nativePipeline],
          binding = c.bindings[variant.nativeBinding],
          program = c.programs[variant.nativeProgram];
        check(
          pipeline.created &&
            program.linked &&
            binding.created &&
            pipeline.nativeProgram === variant.nativeProgram &&
            pipeline.glProgram === program.glHandle &&
            binding.glProgram === program.glHandle,
          "Native material resources disagree",
        );
        const boundTextures = [];
        for (const t of binding.textures) {
          check(
            JSON.stringify(t.sampler.parameters) ===
              JSON.stringify(t.sampler.queriedParameters),
            "Native material sampler was not GPU-state compared",
          );
          boundTextures.push({
            stage: t.stage,
            name: t.name,
            glslName: t.glslName,
            unit: t.unit,
            dimension: t.dimension,
            texture: await texture(c.textures[t.nativeTexture]),
            sampler: {
              descriptorHex: t.sampler.descriptorHex,
              parameters: t.sampler.parameters,
            },
          });
        }
        const constants = binding.uniformBuffers.map((b) => {
          check(
            b.gpuBytesVerified &&
              sha(new Uint8Array(Buffer.from(b.bytesHex, "hex"))) ===
                b.gpuReadbackSha256,
            "Native material constant buffer differs from GPU readback",
          );
          return {
            stage: b.stage,
            name: b.name,
            binding: b.binding,
            bytesHex: b.bytesHex,
            copied: b.copied,
            nativeZeroInitializedMembers: b.nativeZeroInitializedMembers,
            gpuReadbackSha256: b.gpuReadbackSha256,
          };
        });
        const scene = {
          blocks: binding.requiredSceneBlocks,
          textures: binding.requiredSceneTextures,
          dataBuffers: binding.requiredSceneDataBuffers,
        };
        for (const [kind, requirements] of Object.entries(scene))
          for (const requirement of requirements)
            requiredScenes[`${kind}:${requirement.stage}:${requirement.name}`] =
              requirement;
        values.push({
          index: variant.index,
          shaders: {
            vertex: await shader(c, program, "vertex", variant.vertexPath),
            pixel: await shader(c, program, "pixel", variant.pixelPath),
          },
          pipeline: {
            descriptorHex: pipeline.descriptorHex,
            state: pipeline.state,
            nativeGpuStateCompared: true,
            dynamicInputs: ["stencilReference", "blendColor"],
          },
          constantBuffers: constants,
          textures: boundTextures,
          requiredScene: scene,
          scope: {
            actualNativeMaterialFactory: true,
            drawTimeSceneInputsRequired: true,
            perFrameMaterialUpdatesPrepared: false,
            gpuDrawSubmitted: false,
          },
        });
        variants++;
      }
      rows.push({
        index: row.index,
        name: row.name,
        hash: row.hash,
        variants: values,
      });
      passRows++;
    }
    rootActors[actor.emitterIndex] = {
      emitterIndex: actor.emitterIndex,
      primitiveVtableRva: owned.primitiveVtableRva,
      rows,
      aliases: actor.aliases,
    };
    actors++;
  }
  check(
    Object.keys(rootActors).length === c.ownership.actors.length,
    "Native material package omitted an actor",
  );
  roots[c.effectId] = {
    sourceDefinitionSha256: ref.sha256,
    resourceCacheSha256: catalog.caches.find((r) => r.effectId === c.effectId)
      ?.sha256,
    declaredComplexEmitters:
      definition.definition.complexEmitterDefinitionData.length,
    disabledEmitters: c.ownership.disabledEmitters,
    actors: rootActors,
  };
}
const texturePlanes = new Set(
    Object.values(textures).flatMap((t) =>
      t.levels.flat().map((p) => p.sha256),
    ),
  ),
  result = {
    schema: 1,
    kind: "prepared-original-parent-materials",
    build: native.build,
    protocol: native.protocol,
    decoderImageSha256: native.decoderImageSha256,
    nativeObservationSha256: inputs[nativePath],
    effectsManifestSha256: inputs[manifestPath],
    rayParentCachesSha256: inputs[catalogPath],
    registeredPasses: native.cases[0].passes.registeredPasses,
    roots,
    textures,
    shaderStages,
    sceneRequirementInventory: requiredScenes,
    inputs,
    sources: {
      "tools/prepare-parent-native-materials.mjs": sha(
        await raw(import.meta.path),
      ),
    },
    counts: {
      roots: Object.keys(roots).length,
      actors,
      passRows,
      variants,
      textures: Object.keys(textures).length,
      texturePlanes: texturePlanes.size,
      shaderStages: Object.keys(shaderStages).length,
    },
    scope: {
      staticBuildResourcesOnly: true,
      allObservedActorsAndPassesPreserved: true,
      nativeGpuTextureAndConstantBytesCompared: true,
      nativeGpuPipelineAndSamplerStateCompared: true,
      actualFactoryParameters: true,
      sceneInputsProvided: false,
      perFrameUpdatesPrepared: false,
      mainViewerEnabled: false,
      browserExecuted: false,
      gpuDrawSubmitted: false,
      referenceCompared: false,
    },
  };
const bytes = JSON.stringify(result);
await Bun.write(`${directory}/package.json`, bytes);
console.log(JSON.stringify({ sha256: sha(bytes), counts: result.counts }));
