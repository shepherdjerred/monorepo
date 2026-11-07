// Publish only the independently prepared shader research assets to the running preview.
// Serving assets does not establish browser execution or main-viewer integration.
import { resolve } from "node:path";
const [cacheArg, compilerArg] = process.argv.slice(2);
if (!cacheArg || !compilerArg || process.argv.length !== 4)
  throw Error("Usage: publish-latest-shaders.mjs <cache> <compiler workspace>");
const cache = resolve(cacheArg),
  compiler = resolve(compilerArg);
const root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  shaders = `${assets}/latest-shaders`;
const digest = (data) =>
  new Bun.CryptoHasher("sha256").update(data).digest("hex");
const read = async (path) => new Uint8Array(await Bun.file(path).arrayBuffer());
const sha = async (path) => digest(await read(path));
const packageRaw = await read(`${shaders}/package.json`),
  manifest = JSON.parse(new TextDecoder().decode(packageRaw));
if (
  manifest.kind !== "installed-particle-shader-translations" ||
  manifest.build !== "16.21.829.8620" ||
  JSON.stringify(manifest.counts) !==
    JSON.stringify({
      pairs: 11,
      stages: 19,
      permutations: 4243,
      records: 4051,
      uniqueTranslations: 4043,
      failed: 0,
    }) ||
  manifest.compiler.revision !== "a3e5ef85ca4cf50486f2dcd9024831432ec9921b" ||
  manifest.compiler.pipelineVersion !== 4 ||
  manifest.compiler.preparationSha256 !==
    (await sha(`${root}/tools/prepare-latest-shaders.mjs`)) ||
  manifest.compiler.binarySha256 !==
    (await sha(`${compiler}/target/release/scout-shader-prepare.exe`)) ||
  manifest.compiler.sourcesSha256 !== (await sha(`${compiler}/sources.json`)) ||
  manifest.compiler.lockSha256 !== (await sha(`${compiler}/Cargo.lock`))
)
  throw Error("Incomplete shader package or stale compiler provenance");
const compilerSources = await Bun.file(`${compiler}/sources.json`).json();
for (const ref of compilerSources.files)
  if ((await sha(`${compiler}/${ref.path}`)) !== ref.sha256)
    throw Error(`Changed shader compiler source: ${ref.path}`);
for (const [name, path] of [
  ["Cargo.toml", "tools/hexshade-cli/Cargo.toml"],
  ["src/main.rs", "tools/hexshade-cli/src/main.rs"],
])
  if (
    (await sha(`${root}/${path}`)) !==
    (await sha(`${compiler}/scout-shader-prepare/${name}`))
  )
    throw Error("Built shader CLI differs from source");
if (
  compilerSources.preparerSha256 !==
  (await sha(`${root}/tools/prepare-hexshade.py`))
)
  throw Error("Compiler preparer changed");
const pairsRaw = await read(`${cache}/research/latest-shaders/pairs.json`),
  pairs = JSON.parse(new TextDecoder().decode(pairsRaw));
const angleRaw = await read(`${cache}/research/latest-shaders/angle.json`),
  angle = JSON.parse(new TextDecoder().decode(angleRaw));
if (
  pairs.shaderPackageSha256 !== digest(packageRaw) ||
  pairs.preparerSha256 !==
    (await sha(`${root}/tools/prepare-shader-pairs.mjs`)) ||
  pairs.programs.length !== 14756 ||
  angle.shaderPackageSha256 !== digest(packageRaw) ||
  angle.pairInventorySha256 !== digest(pairsRaw) ||
  angle.observerSha256 !==
    (await sha(`${root}/tools/observe-shader-angle.py`)) ||
  JSON.stringify(angle.counts) !==
    JSON.stringify({
      compiled: 4043,
      compileFailures: 0,
      linked: 420,
      uniqueLinks: 420,
      unobservedPrograms: 14336,
      linkFailures: 0,
    }) ||
  !angle.context.webglCompatibility ||
  !angle.context.renderer.includes("Microsoft Basic Render Driver")
)
  throw Error("Incomplete shader compile/link evidence");
const selected = [
  "quad",
  "quadFixedAlphaUv",
  "quadScreenSpaceUv",
  "quadSlice",
  "distortion",
  "distortionMesh",
  "distortionAttachedMesh",
];
if (
  JSON.stringify(angle.selectedFamilies) !== JSON.stringify(selected) ||
  angle.programs.some((p) => !p.success || !selected.includes(p.family)) ||
  angle.stages.some((s) => !s.success) ||
  new Set(angle.stages.map((s) => s.key)).size !== 4043 ||
  new Set(angle.programs.map((p) => p.index)).size !== 420
)
  throw Error("Incomplete shader observation scope");
for (const ref of manifest.translations) {
  const observed = angle.stages.find(
    (s) => s.key === `${ref.stage}:${ref.dxbcSha256}`,
  );
  if (
    !observed ||
    observed.sha256 !== ref.sha256 ||
    (await sha(`${shaders}/${ref.file}`)) !== ref.sha256 ||
    (await sha(`${shaders}/${ref.dxbc}`)) !== ref.dxbcSha256
  )
    throw Error("Shader translation/input/observation mismatch");
}
for (let i = 0; i < pairs.programs.length; i++) {
  const program = pairs.programs[i];
  if (
    selected.includes(program.family) &&
    !angle.programs.some((p) => p.index === i && p.family === program.family)
  )
    throw Error("Shader pair omitted from selected scope");
}
const visual = await Bun.file(
  `${assets}/evidence/latest-particle-shader.json`,
).json();
if (
  visual.rendererSha256 !==
    (await sha(`${root}/tools/render-particle-shader.py`)) ||
  visual.angleAdapterSha256 !== angle.observerSha256 ||
  visual.imageSha256 !==
    (await sha(`${assets}/evidence/latest-particle-shader.png`)) ||
  visual.samples.length !== 6 ||
  visual.samples.some((s) => s.foregroundPixels < 100) ||
  JSON.stringify(visual.libraries) !== JSON.stringify(angle.libraries) ||
  JSON.stringify(visual.context) !== JSON.stringify(angle.context) ||
  visual.scope.browserRendered ||
  visual.scope.referencePixelsCompared ||
  visual.scope.nativeBindingsRecovered ||
  visual.scope.mainViewerIntegrated
)
  throw Error("Incomplete shader visual or missing limitations");
for (const [path, expected] of Object.entries(visual.sources))
  if ((await sha(path)) !== expected)
    throw Error(`Stale shader visual input ${path}`);
await Bun.write(`${assets}/evidence/latest-shader-pairs.json`, pairsRaw);
await Bun.write(`${assets}/evidence/latest-shader-angle.json`, angleRaw);
const paths = [
  "/README.md",
  "/AV-FIDELITY-MAP.md",
  "/latest.html",
  "/assets/latest-shaders/package.json",
  "/assets/latest-shaders/HEXShade-LICENSE.txt",
  "/assets/evidence/latest-shader-pairs.json",
  "/assets/evidence/latest-shader-angle.json",
  "/assets/evidence/latest-particle-shader.png",
  "/assets/evidence/latest-particle-shader.json",
];
for (const ref of manifest.translations)
  paths.push(
    `/assets/latest-shaders/${ref.file}`,
    `/assets/latest-shaders/${ref.dxbc}`,
  );
const uniquePaths = [...new Set(paths)],
  results = [];
for (const base of [
  "http://127.0.0.1:4180",
  "https://desktop.tailnet-1a49.ts.net",
]) {
  let next = 0;
  await Promise.all(
    Array.from({ length: base.includes("127.0.0.1") ? 16 : 4 }, async () => {
      while (next < uniquePaths.length) {
        const path = uniquePaths[next++],
          response = await fetch(`${base}${path}`, {
            signal: AbortSignal.timeout(30000),
          });
        const data = await response.arrayBuffer(),
          file = path.startsWith("/assets/")
            ? `${assets}/${path.slice(8)}`
            : `${root}${path}`;
        if (response.status !== 200 || digest(data) !== (await sha(file)))
          throw Error(`Shader publication mismatch: ${base}${path}`);
        results.push({
          base,
          path,
          status: response.status,
          sha256: digest(data),
        });
      }
    }),
  );
  console.log(JSON.stringify({ base, matchedFiles: uniquePaths.length }));
}
const result = {
  schema: 1,
  kind: "particle-shader-publication",
  build: manifest.build,
  shaderPackageSha256: digest(packageRaw),
  pairInventorySha256: digest(pairsRaw),
  angleObservationSha256: digest(angleRaw),
  imageSha256: visual.imageSha256,
  publisherSha256: await sha(import.meta.path),
  counts: manifest.counts,
  angleCounts: angle.counts,
  scope: {
    browserRun: false,
    mainViewerIntegrated: false,
    referencePixelsCompared: false,
  },
  results,
};
await Bun.write(
  `${cache}/research/latest-shaders/publication.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({
    checked: results.length,
    compileFailures: angle.counts.compileFailures,
    linkFailures: angle.counts.linkFailures,
  }),
);
