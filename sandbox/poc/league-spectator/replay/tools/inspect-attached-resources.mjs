import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  ATTACHED_RESOURCES_SHA,
  createLatestInitialAttachedResources,
} from "../latest-attached-resources.mjs";
import { createLatestAttachedMaterials } from "../latest-attached-materials.mjs";
const [arg] = process.argv.slice(2);
if (!arg) throw Error("Usage: inspect-attached-resources.mjs <cache>");
const cache = resolve(arg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => {
    const b = new Uint8Array(await Bun.file(p).arrayBuffer());
    inputs[p] = sha(b);
    return b;
  },
  json = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  native = await json(`${cache}/research/attached-resources-native.json`),
  bytes = await raw(`${assets}/latest-attached-resources/package.json`),
  meta = JSON.parse(new TextDecoder().decode(bytes)),
  profile = await json(`${assets}/decoder-16.21-macos/profile.json`),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`),
  attachedBytes = await raw(`${assets}/latest-attached-mesh/package.json`),
  effectsBytes = await raw(`${assets}/latest-effects/manifest.json`),
  materialBytes = await raw(`${cache}/research/attached-materials-native.json`),
  materials = await createLatestAttachedMaterials(
    materialBytes,
    sha(materialBytes),
    profile,
  ),
  resources = await createLatestInitialAttachedResources(
    profile,
    attachedBytes,
    effectsBytes,
    bytes,
  ),
  counts = {
    emitters: 0,
    initialSelectionChecks: 0,
    externalBoundaries: 0,
    descriptionCopies: 0,
    rejectionChecks: 0,
  };
check(
  native.packageSha256 === ATTACHED_RESOURCES_SHA &&
    sha(bytes) === ATTACHED_RESOURCES_SHA &&
    sha(image) === meta.decoderImageSha256,
  "Initial resource package differs",
);
for (const [path, h] of Object.entries(native.inputs))
  check(sha(await raw(path)) === h, `Initial resource input changed: ${path}`);
for (const [name, h] of Object.entries(native.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === h,
    `Initial resource native source changed: ${name}`,
  );
for (const block of native.originalBlocks)
  check(
    sha(image.subarray(block.rva, block.rva + block.size)) === block.sha256,
    "Initial resource native code changed",
  );
async function rejects(fn) {
  let rejected = false;
  try {
    await fn();
  } catch {
    rejected = true;
  }
  check(rejected, "Unadmitted initial resource input accepted");
  counts.rejectionChecks++;
}
for (const observation of native.observations) {
  const row = meta.entries[observation.key],
    d = resources.describe(row.effectId, row.emitterIndex);
  check(
    isDeepStrictEqual(d, row) &&
      d.status === observation.result.status &&
      d.externalMeshPath === observation.result.externalMeshPath,
    "Initial resource description differs",
  );
  d.status = "mutated";
  check(
    resources.describe(row.effectId, row.emitterIndex).status === row.status,
    "Resource description leaked mutation",
  );
  counts.descriptionCopies++;
  counts.emitters++;
  if (row.status === "external-mesh-factory-required") {
    await rejects(() =>
      resources.materialInput(
        row.effectId,
        row.emitterIndex,
        observation.baselineEnvironment,
      ),
    );
    counts.externalBoundaries++;
    continue;
  }
  const env = resources.materialInput(
      row.effectId,
      row.emitterIndex,
      observation.baselineEnvironment,
    ),
    material = materials.describe(row.effectId, row.emitterIndex, env);
  check(
    material.vertex === observation.nativeSelection.vertex &&
      material.pixel === observation.nativeSelection.pixel &&
      material.linkShaderFlag1a ===
        observation.nativeSelection.linkShaderFlag1a &&
      material.vertex.toLowerCase().includes("/skinnedmesh/particle"),
    "Native-derived initial material differs",
  );
  counts.initialSelectionChecks++;
}
const first = native.observations.find(
    (o) => o.result.status === "no-authored-mesh-resource",
  ),
  r = meta.entries[first.key],
  env = first.baselineEnvironment;
await rejects(() =>
  createLatestInitialAttachedResources(
    { ...profile, clientVersion: "wrong" },
    attachedBytes,
    effectsBytes,
    bytes,
  ),
);
await rejects(() =>
  createLatestInitialAttachedResources(
    profile,
    attachedBytes,
    effectsBytes,
    new Uint8Array(),
  ),
);
await rejects(() => resources.describe("absent", 0));
for (const input of [
  { ...env, resolvedResourceFlag95: false },
  { ...env, pass: 7 },
  { ...env, resourceMask: 8 },
  { ...env, featuresEnabled: 1 },
  { ...env, systemFogMode: 2 },
])
  await rejects(() =>
    resources.materialInput(r.effectId, r.emitterIndex, input),
  );
const build = await Bun.build({
  entrypoints: [`${root}/latest-attached-resources.mjs`],
  target: "browser",
  external: ["three", "/assets/*"],
});
check(build.success, "Initial resource browser-target build failed");
const result = {
  schema: 1,
  kind: "initial-attached-resource-comparison",
  packageSha256: ATTACHED_RESOURCES_SHA,
  inspectorSha256: sha(await raw(import.meta.path)),
  moduleSha256: sha(await raw(`${root}/latest-attached-resources.mjs`)),
  inputs,
  counts,
  scope: {
    ...meta.scope,
    browserCompatibleAdapterCompared: true,
    browserTargetBuild: true,
    initialShaderSelectionCompared: true,
  },
};
await Bun.write(
  `${cache}/research/attached-resources-comparison.json`,
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(counts));
