// Inspect shared color lookup admission and preservation of every prior binding.
import { resolve } from "node:path";
import { loadNativeParticleColorBindings } from "./particle-color-bindings.mjs";
import { prepareNativeParticleGpuBinding } from "./particle-gpu-bindings.mjs";
const [arg] = process.argv.slice(2);
if (!arg || process.argv.length !== 3)
  throw Error("Usage: inspect-particle-color-gpu.mjs <cache>");
const cache = resolve(arg),
  assets = `${cache}/public`,
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = new Uint8Array(await Bun.file(p).arrayBuffer());
    inputs[p] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  colorBindings = await loadNativeParticleColorBindings({ assets, raw, sha }),
  effects = await read(`${assets}/latest-effects/manifest.json`),
  counts = {
    priorBindingsPreserved: 0,
    newBindings: 0,
    colorTextureBindings: 0,
    rejections: 0,
  },
  examples = [];
for (const [priorPath, currentPath] of [
  [
    `${cache}/research/complete-quad-gpu-before-color.json`,
    `${assets}/latest-complete-quad-gpu/package.json`,
  ],
  [
    `${cache}/research/trail-gpu-before-color.json`,
    `${assets}/latest-trail-particles/gpu.json`,
  ],
]) {
  const prior = await read(priorPath),
    current = await read(currentPath),
    byKey = new Map(
      current.emitters.map((e) => [`${e.effectId}:${e.emitterIndex}`, e]),
    ),
    oldKeys = new Set(
      prior.emitters.map((e) => `${e.effectId}:${e.emitterIndex}`),
    );
  check(byKey.size === current.emitters.length, "Duplicate GPU binding");
  for (const old of prior.emitters) {
    check(
      JSON.stringify(byKey.get(`${old.effectId}:${old.emitterIndex}`)) ===
        JSON.stringify(old),
      "Previously prepared GPU binding changed",
    );
    counts.priorBindingsPreserved++;
  }
  for (const e of current.emitters) {
    const key = `${e.effectId}:${e.emitterIndex}`,
      native = colorBindings.get(key);
    if (oldKeys.has(key)) continue;
    counts.newBindings++;
    check(
      native && native.graphSha256 === e.graphSha256,
      "New binding lacks original color sampler",
    );
    const record = await read(
        `${assets}/latest-effects/${effects.definitions[e.effectId].file}`,
      ),
      emitter = record.definition.complexEmitterDefinitionData[e.emitterIndex];
    check(
      emitter.particleColorTexture === native.authoredPath,
      "Authored color texture differs",
    );
    let bindings = 0;
    for (const stage of ["vertex", "pixel"]) {
      const shader = await read(
        `${assets}/latest-shaders/${e.shaders[stage].file}`,
      );
      check(
        inputs[`${assets}/latest-shaders/${e.shaders[stage].file}`] ===
          e.shaders[stage].sha256,
        "Color shader changed",
      );
      for (const t of shader.sidecar.textures.filter(
        (t) => t.name === "PARTICLE_COLOR_TEXTURE__TX",
      ))
        for (const s of t.samplers) {
          const b = e.textures[s.glslName];
          check(
            b?.kind === "prepared-texture" &&
              b.file === native.asset.file &&
              b.sha256 === native.asset.sha256 &&
              b.nativeSamplerHex === native.descriptorHex &&
              b.sampler.name === "clamp" &&
              b.sampler.pixelated === native.descriptorHex.endsWith("0000"),
            "Prepared GPU color binding differs from original sampler/asset",
          );
          counts.colorTextureBindings++;
          bindings++;
        }
    }
    check(bindings > 0, "New color admission does not bind a shader lookup");
    if (
      examples.length < 3 ||
      !examples.some((x) => x.primitiveKind === native.primitiveKind)
    )
      examples.push({ ...native, gpu: e });
  }
}
check(
  counts.priorBindingsPreserved === 1504 && counts.newBindings === 404,
  "Unexpected color GPU coverage",
);
const sample = examples[0],
  record = await read(
    `${assets}/latest-effects/${effects.definitions[sample.effectId].file}`,
  ),
  n = {
    effectId: sample.effectId,
    emitterIndex: sample.emitterIndex,
    sha256: sample.graphSha256,
    sourceDefinitionSha256: sample.sourceDefinitionSha256,
    needsErosionDrive: false,
  };
for (const field of ["graphSha256", "sourceDefinitionSha256", "authoredPath"]) {
  let rejected = false;
  try {
    await prepareNativeParticleGpuBinding(n, record, {
      colorBindings: new Map([
        [`${n.effectId}:${n.emitterIndex}`, { ...sample, [field]: "changed" }],
      ]),
    });
  } catch (error) {
    check(
      error.message === "Native particle color graph/definition differs",
      "Unexpected color contract error",
    );
    rejected = true;
  }
  check(rejected, `Wrong native color ${field} accepted`);
  counts.rejections++;
}
const sources = {};
for (const name of [
  "particle-color-bindings.mjs",
  "particle-gpu-bindings.mjs",
  "inspect-particle-color-gpu.mjs",
])
  sources[name] = sha(await raw(resolve(import.meta.dir, name)));
const result = {
  schema: 1,
  kind: "native-particle-color-gpu-comparison",
  inputs,
  sources,
  counts,
  examples,
  scope: {
    originalSamplerValues: true,
    priorGpuBindingsPreserved: true,
    textureAcquisitionExecuted: false,
    nativeFactoryExecuted: false,
    browserRun: false,
    referenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/particle-color-gpu-comparison.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(counts));
