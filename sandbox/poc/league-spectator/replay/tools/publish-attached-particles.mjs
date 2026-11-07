import { resolve, dirname, relative } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { ATTACHED_PARTICLES_SHA } from "../latest-attached-particles.mjs";
import { createLatestAttachedMaterials } from "../latest-attached-materials.mjs";
import { createAttachedParticleMaterialParameters } from "../latest-attached-particle-material.mjs";
const [arg] = process.argv.slice(2);
if (!arg) throw Error("Usage: publish-attached-particles.mjs <cache>");
const cache = resolve(arg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  raw = async (p) => new Uint8Array(await Bun.file(p).arrayBuffer()),
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  json = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  packagePath = `${assets}/latest-attached-particles/package.json`,
  meta = await json(packagePath),
  nativePath = `${cache}/research/attached-particles-native.json`,
  native = await json(nativePath),
  proofPath = `${cache}/research/attached-particles-comparison.json`,
  proof = await json(proofPath),
  visual = await json(
    `${assets}/evidence/latest-attached-particle-sequence.json`,
  ),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`),
  profile = await json(`${assets}/decoder-16.21-macos/profile.json`),
  materialBytes = await raw(`${cache}/research/attached-materials-native.json`),
  materials = await createLatestAttachedMaterials(
    materialBytes,
    sha(materialBytes),
    profile,
  );
check(
  sha(await raw(packagePath)) === ATTACHED_PARTICLES_SHA &&
    native.packageSha256 === ATTACHED_PARTICLES_SHA &&
    proof.packageSha256 === ATTACHED_PARTICLES_SHA &&
    proof.nativeSha256 === sha(await raw(nativePath)) &&
    native.observerSha256 ===
      sha(await raw(`${root}/tools/observe-attached-particles.py`)) &&
    proof.inspectorSha256 ===
      sha(await raw(`${root}/tools/inspect-attached-particles.mjs`)) &&
    visual.rendererSha256 ===
      sha(await raw(`${root}/tools/render-attached-particle-sequence.py`)) &&
    visual.meshDrawAdapterSha256 ===
      sha(await raw(`${root}/tools/render-attached-materials.py`)) &&
    visual.imageSha256 ===
      sha(
        await raw(`${assets}/evidence/latest-attached-particle-sequence.png`),
      ),
  "Attached particle evidence stale",
);
for (const record of [meta, proof, visual])
  for (const [path, h] of Object.entries(record.inputs))
    check(sha(await raw(path)) === h, `Particle input changed: ${path}`);
for (const [name, h] of Object.entries(meta.compilerSources))
  check(
    native.compilerSources[name] === h &&
      sha(await raw(`${root}/tools/${name}`)) === h,
    `Particle native source changed: ${name}`,
  );
for (const [name, h] of Object.entries(proof.sources))
  check(
    sha(await raw(`${root}/${name}`)) === h,
    `Particle runtime source changed: ${name}`,
  );
for (const [name, h] of Object.entries(visual.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === h,
    `Particle renderer source changed: ${name}`,
  );
for (const record of [native, visual])
  for (const b of record.originalBlocks ?? record.materialOriginalBlocks)
    check(
      sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
      "Original particle/material code changed",
    );
check(
  isDeepStrictEqual(meta.counts, {
    sourceEmitters: 181,
    preparedEmitters: 179,
    rejectedEmitters: 2,
  }) &&
    isDeepStrictEqual(native.counts, {
      graphs: 179,
      cases: 187,
      frames: 2992,
      births: 255,
      liveGraphs: 177,
      assetPreservationChecks: 2992,
    }) &&
    isDeepStrictEqual(proof.counts, {
      graphs: 179,
      frames: 2992,
      births: 255,
      checkpointFrames: 1496,
      resetFrames: 2992,
      previewFrames: 2992,
      previewDifferences: 0,
      drawInputChecks: 7419,
      completeAssetBytes: 380928,
      libraryCalls: 28217,
      rejectionChecks: 5,
    }),
  "Attached pool coverage differs",
);
check(
  proof.scope.nativePoolStateCompared === true &&
    proof.scope.checkpointsCompared === true &&
    proof.scope.originalFrameCadenceVerified === false &&
    proof.scope.recordedSeedRecovered === false &&
    proof.scope.ownerPoseBindingExecuted === false &&
    proof.scope.fullEffectLifecycleReconstructed === false &&
    proof.scope.browserRun === false &&
    proof.scope.mainViewerIntegrated === false &&
    visual.scope.nativePoolSamples === true &&
    visual.scope.nativeDynamicErosionParametersExecuted === true &&
    visual.scope.suppliedFixedCharacterPose === true &&
    visual.scope.effectActivationReconstructed === false &&
    visual.scope.drawSchedulingReconstructed === false &&
    visual.scope.browserRun === false &&
    visual.scope.mainViewerIntegrated === false &&
    visual.scope.referencePixelsCompared === false,
  "Attached pool evidence scope differs",
);
const vecHex = (v) => {
  const b = new DataView(new ArrayBuffer(v.length * 4));
  v.forEach((x, i) => b.setFloat32(i * 4, x, true));
  return Buffer.from(b.buffer).toString("hex");
};
let materialCompositionChecks = 0;
check(visual.samples.length === 12, "Particle sequence coverage differs");
for (const sample of visual.samples) {
  const c = native.cases.find(
      (c) =>
        c.effectId === "champions/viego/43/4f77a64e" &&
        c.emitterIndex === sample.emitterIndex &&
        c.mode === 0,
    ),
    f = c.frames.find((f) => f.input.time === sample.time);
  check(
    isDeepStrictEqual(f.drawValues, sample.nativeDrawValues) &&
      sample.liveParticles === f.drawValues.length,
    "Sequence draw sample differs from native pool",
  );
  for (const draw of f.drawValues) {
    const material = materials.describe(c.effectId, c.emitterIndex, {
        pass: 0,
        featuresEnabled: true,
        resourceMask: 0,
        systemFogMode: 0,
        graphics34b: false,
        graphics29c: 0,
        resolvedResourceFlag95: null,
      }),
      params = createAttachedParticleMaterialParameters(material, draw);
    check(
      vecHex([...params.get("kColorFactor")]) === draw.colorFactor.bytesHex,
      "Particle color material binding differs",
    );
    for (const p of sample.nativeErosionParameters)
      check(
        vecHex([...params.get(p.name)]) === p.bytesHex,
        "Particle erosion material binding differs",
      );
    materialCompositionChecks++;
  }
}
const build = await Bun.build({
  entrypoints: [
    `${root}/latest-attached-particles.mjs`,
    `${root}/latest-attached-particle-material.mjs`,
  ],
  target: "browser",
  external: ["three", "/assets/*"],
});
check(
  build.success && build.outputs.length === 2,
  "Attached particle browser-target build failed",
);
const paths = new Map(),
  visited = new Set();
async function include(file) {
  if (visited.has(file)) return;
  visited.add(file);
  paths.set(`/${relative(root, file).replaceAll("\\", "/")}`, file);
  for (const m of (await Bun.file(file).text()).matchAll(
    /(?:from\s*|import\s*\()\s*["'](\.\.?\/[^"']+\.mjs)["']/g,
  ))
    await include(resolve(dirname(file), m[1]));
}
await include(`${root}/latest-attached-particles.mjs`);
await include(`${root}/latest-attached-particle-material.mjs`);
for (const name of ["README.md", "AV-FIDELITY-MAP.md"])
  paths.set(`/${name}`, `${root}/${name}`);
for (const record of [meta, proof, visual])
  for (const file of Object.keys(record.inputs)) {
    const rel = relative(assets, resolve(file));
    if (!rel.startsWith("..") && !rel.includes(":"))
      paths.set(`/assets/${rel.replaceAll("\\", "/")}`, file);
  }
for (const ref of meta.templates)
  paths.set(
    `/assets/latest-attached-particles/${ref.file}`,
    `${assets}/latest-attached-particles/${ref.file}`,
  );
paths.set("/assets/latest-attached-particles/package.json", packagePath);
for (const suffix of ["png", "json"])
  paths.set(
    `/assets/evidence/latest-attached-particle-sequence.${suffix}`,
    `${assets}/evidence/latest-attached-particle-sequence.${suffix}`,
  );
for (const name of [
  "attached-particles-native.json",
  "attached-particles-comparison.json",
]) {
  const dest = `${assets}/evidence/${name}`;
  await Bun.write(dest, await raw(`${cache}/research/${name}`));
  paths.set(`/assets/evidence/${name}`, dest);
}
const files = await Promise.all(
    [...paths].map(async ([path, file]) => ({
      path,
      sha256: sha(await raw(file)),
    })),
  ),
  checks = [];
for (const origin of [
  "http://127.0.0.1:4180",
  "https://desktop.tailnet-1a49.ts.net",
]) {
  let cursor = 0;
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, async () => {
      while (cursor < files.length) {
        const item = files[cursor++],
          r = await fetch(`${origin}${item.path}`, {
            signal: AbortSignal.timeout(30000),
          });
        check(
          r.status === 200 && sha(await r.arrayBuffer()) === item.sha256,
          `Particle HTTP delivery differs: ${origin}${item.path}`,
        );
        checks.push({ url: `${origin}${item.path}`, sha256: item.sha256 });
      }
    }),
  );
  for (const r of results) if (r.status === "rejected") throw r.reason;
}
await Bun.write(
  `${cache}/research/attached-particles-publication.json`,
  JSON.stringify(
    {
      schema: 1,
      publisherSha256: sha(await raw(import.meta.path)),
      comparisonSha256: sha(await raw(proofPath)),
      materialBridgeSha256: sha(
        await raw(`${root}/latest-attached-particle-material.mjs`),
      ),
      counts: proof.counts,
      materialCompositionChecks,
      imageSha256: visual.imageSha256,
      scope: visual.scope,
      checks: checks.sort((a, b) => a.url.localeCompare(b.url)),
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    matchedFiles: checks.length,
    counts: proof.counts,
    materialCompositionChecks,
  }),
);
