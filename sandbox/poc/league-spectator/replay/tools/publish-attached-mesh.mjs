import { resolve, dirname, relative } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { ATTACHED_MESH_SHA } from "../latest-attached-mesh.mjs";

const [arg] = process.argv.slice(2);
if (!arg) throw Error("Usage: publish-attached-mesh.mjs <cache>");
const cache = resolve(arg),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  raw = async (p) => new Uint8Array(await Bun.file(p).arrayBuffer()),
  json = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  nativePath = `${cache}/research/attached-mesh-native.json`,
  proofPath = `${cache}/research/attached-mesh-comparison.json`,
  native = await json(nativePath),
  proof = await json(proofPath),
  visual = await json(`${assets}/evidence/latest-attached-mesh.json`),
  meta = await json(`${assets}/latest-attached-mesh/package.json`),
  image = await raw(`${assets}/decoder-16.21-macos/image.bin`);
check(
  native.packageSha256 === ATTACHED_MESH_SHA &&
    proof.packageSha256 === ATTACHED_MESH_SHA &&
    sha(await raw(`${assets}/latest-attached-mesh/package.json`)) ===
      ATTACHED_MESH_SHA &&
    meta.decoderImageSha256 === sha(image),
  "Attached mesh package differs",
);
check(
  native.preparerSha256 ===
    sha(await raw(`${root}/tools/prepare-attached-mesh.py`)) &&
    proof.nativeEvidenceSha256 === sha(await raw(nativePath)) &&
    proof.inspectorSha256 ===
      sha(await raw(`${root}/tools/inspect-attached-mesh.mjs`)) &&
    visual.comparisonSha256 === sha(await raw(proofPath)) &&
    visual.rendererSha256 ===
      sha(await raw(`${root}/tools/render-attached-mesh.mjs`)) &&
    visual.imageSha256 ===
      sha(await raw(`${assets}/evidence/latest-attached-mesh.png`)) &&
    visual.svgSha256 ===
      sha(await raw(`${assets}/evidence/latest-attached-mesh.svg`)) &&
    isDeepStrictEqual(proof.counts, visual.counts),
  "Attached mesh evidence stale",
);
for (const record of [native, proof, visual])
  for (const [p, h] of Object.entries(record.inputs))
    check(sha(await raw(p)) === h, `Attached mesh input changed: ${p}`);
for (const [name, h] of Object.entries(native.sources))
  check(
    sha(await raw(`${root}/tools/${name}`)) === h,
    `Native helper changed: ${name}`,
  );
for (const [name, h] of Object.entries(proof.sources))
  check(
    sha(await raw(`${root}/${name}`)) === h,
    `Translation changed: ${name}`,
  );
for (const b of native.originalBlocks)
  check(
    sha(image.subarray(b.rva, b.rva + b.size)) === b.sha256,
    "Native instructions changed",
  );
check(
  isDeepStrictEqual(native.counts, {
    emitters: 181,
    cacheChecks: 1448,
    drawMaskChecks: 13032,
    secondPassChecks: 13032,
    channelChecks: 362,
    assetPreservationChecks: 181,
  }) &&
    isDeepStrictEqual(proof.counts, {
      emitters: 181,
      cacheChecks: 1448,
      drawMaskChecks: 13032,
      secondPassChecks: 13032,
      channelChecks: 362,
      checkpointChecks: 1448,
      reloadChecks: 1448,
      appearanceChecks: 10,
      unresolvedLists: 115,
      rejectionChecks: 14,
    }),
  "Attached mesh coverage differs",
);
const trueScope = [
    "completePostloadedAssetRead",
    "nativeResourceMapConstructorExecuted",
    "nativeMaskCachePrefixExecuted",
    "nativeDrawMaskFragmentsExecuted",
    "nativeMaskChannelBranchExecuted",
    "browserCompatibleTranslationCompared",
    "checkpointsCompared",
    "diagnosticOwnerMasksSupplied",
  ],
  falseScope = [
    "originalOwnerLookupExecuted",
    "originalParticleSimulationExecuted",
    "meshPoseBindingExecuted",
    "shaderMaterialBindingExecuted",
    "graphicsSubmissionExecuted",
    "mainViewerIntegrated",
    "leagueAvCompared",
    "browserRun",
  ];
for (const key of trueScope)
  check(proof.scope[key] === true, `Missing scope: ${key}`);
for (const key of falseScope)
  check(proof.scope[key] === false, `Unsupported scope: ${key}`);
check(
  visual.scope.softwareMeshSelectionProjection === true &&
    visual.scope.actualWebGlCapture === false &&
    visual.scope.deathVfxRendered === false &&
    visual.scope.effectMaterialsApplied === false &&
    isDeepStrictEqual(visual.triangles, [0, 19769, 2553, 22322]),
  "Geometry diagnostic scope differs",
);
const build = await Bun.build({
  entrypoints: [
    `${root}/latest-attached-mesh.mjs`,
    `${root}/latest-viewer.mjs`,
    `${root}/structural-check-worker.mjs`,
  ],
  target: "browser",
  external: ["three", "/assets/*"],
});
check(
  build.success && build.outputs.length === 3,
  `Browser-target build failed: ${build.logs.join("\n")}`,
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
for (const name of [
  "latest-attached-mesh.mjs",
  "latest-viewer.mjs",
  "structural-check-worker.mjs",
])
  await include(`${root}/${name}`);
for (const name of ["latest.html", "README.md", "AV-FIDELITY-MAP.md"])
  paths.set(`/${name}`, `${root}/${name}`);
for (const record of [native, proof, visual])
  for (const file of Object.keys(record.inputs)) {
    const rel = relative(assets, resolve(file));
    if (!rel.startsWith("..") && !rel.includes(":"))
      paths.set(`/assets/${rel.replaceAll("\\", "/")}`, file);
  }
for (const suffix of ["png", "svg", "json"])
  paths.set(
    `/assets/evidence/latest-attached-mesh.${suffix}`,
    `${assets}/evidence/latest-attached-mesh.${suffix}`,
  );
for (const name of [
  "attached-mesh-native.json",
  "attached-mesh-comparison.json",
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
          `HTTP delivery differs: ${origin}${item.path}`,
        );
        checks.push({ url: `${origin}${item.path}`, sha256: item.sha256 });
      }
    }),
  );
  for (const r of results) if (r.status === "rejected") throw r.reason;
}
await Bun.write(
  `${cache}/research/attached-mesh-publication.json`,
  JSON.stringify(
    {
      schema: 1,
      publisherSha256: sha(await raw(import.meta.path)),
      comparisonSha256: sha(await raw(proofPath)),
      imageSha256: visual.imageSha256,
      counts: proof.counts,
      scope: proof.scope,
      checks: checks.sort((a, b) => a.url.localeCompare(b.url)),
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({ matchedFiles: checks.length, counts: proof.counts }),
);
