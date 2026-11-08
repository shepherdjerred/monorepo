// Select build assets requested by the decoded replay. Runtime events stay in
// this research input; exported resource caches contain only static build data.
import { resolve } from "node:path";
import { createLatestEffectPipeline } from "../latest-effect-pipeline.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  inputs = {};
const sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = await Bun.file(p).bytes();
    inputs[p] = sha(b);
    return b;
  },
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p)));
const report = await read(`${cache}/research/latest-semantics-effects.json`),
  effectsManifestBytes = await raw(`${assets}/latest-effects/manifest.json`),
  effects = JSON.parse(new TextDecoder().decode(effectsManifestBytes));
const pipeline = await createLatestEffectPipeline({
  report,
  effectsManifestBytes,
  quadGpuBytes: await raw(`${assets}/latest-complete-quad-gpu/package.json`),
  trailGpuBytes: await raw(`${assets}/latest-trail-particles/gpu.json`),
});
const roots = new Map();
for (let i = 0; i < report.effectCreations.length; i++) {
  const request = pipeline.creation(i);
  if (request.resource.status !== "prepared-context-resource") continue;
  const id = request.resource.effectId;
  if (!roots.has(id)) {
    const ref = effects.definitions[id],
      data = await raw(`${assets}/latest-effects/${ref.file}`);
    if (sha(data) !== ref.sha256) throw Error("Effect root source changed");
    const definition = JSON.parse(new TextDecoder().decode(data)).definition;
    roots.set(id, {
      effectId: id,
      name: definition.particleName,
      sourceDefinitionSha256: ref.sha256,
      requests: 0,
      completeGpuBindings: request.capability.complete,
      complexEmitters: ref.complexEmitters,
      simpleEmitters: ref.simpleEmitters,
      descriptorIndices: [],
    });
  }
  const entry = roots.get(id);
  entry.requests++;
  entry.descriptorIndices.push(i);
}
const sources = {};
for (const name of [
  "latest-effect-pipeline.mjs",
  "latest-effect-creation.mjs",
  "latest-effect-descriptor.mjs",
  "latest-effect-placement.mjs",
  "tools/prepare-effect-root-inputs.mjs",
])
  sources[name] = sha(await raw(`${root}/${name}`));
const list = [...roots.values()].sort(
  (a, b) => b.requests - a.requests || a.effectId.localeCompare(b.effectId),
);
const result = {
  schema: 1,
  kind: "replay-requested-effect-root-inputs",
  build: report.build,
  protocol: report.protocol,
  inputs,
  sources,
  roots: list,
  counts: {
    creationRequests: report.effectCreations.length,
    resolvedRequests: list.reduce((n, r) => n + r.requests, 0),
    roots: list.length,
    rootsWithCompleteGpuBindings: list.filter((r) => r.completeGpuBindings)
      .length,
  },
};
await Bun.write(
  `${cache}/research/effect-root-inputs.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result.counts));
