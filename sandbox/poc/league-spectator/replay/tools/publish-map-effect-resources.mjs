// Publish build-only map resource components on the existing private preview.
import { resolve } from "node:path";
import { MAP_EFFECT_RESOURCES_SHA } from "../latest-map-effect-resources.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  root = resolve(import.meta.dir, ".."),
  assets = `${cache}/public`,
  raw = (p) => Bun.file(p).bytes(),
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  read = async (p) => JSON.parse(new TextDecoder().decode(await raw(p))),
  check = (v, m) => {
    if (!v) throw Error(m);
  },
  proofBytes = await raw(
    `${cache}/research/map-effect-resources-comparison.json`,
  ),
  proof = JSON.parse(new TextDecoder().decode(proofBytes)),
  packageBytes = await raw(
    `${assets}/latest-map-effect-resources/package.json`,
  ),
  meta = JSON.parse(new TextDecoder().decode(packageBytes)),
  files = new Map();
check(
  proof.kind === "native-wasm-map-global-resource-comparison" &&
    proof.mismatchCount === 0 &&
    proof.packageSha256 === MAP_EFFECT_RESOURCES_SHA &&
    sha(packageBytes) === MAP_EFFECT_RESOURCES_SHA &&
    proof.counts.authoredMaps === 17 &&
    proof.counts.authoredRows === 505 &&
    proof.counts.merges === 15 &&
    proof.counts.globalQueries === 2550 &&
    proof.counts.mapDeclarations === 578 &&
    proof.counts.unresolvedStageComparisons === 3 &&
    proof.scope.completeGlobalLookupWasmCompared &&
    proof.scope.replayCatalogJoinOnly &&
    !proof.scope.activeMapVariantRecovered &&
    !proof.scope.activeGuestRecovered &&
    !proof.scope.worldFactoryExecuted &&
    !proof.scope.browserExecuted,
  "Complete scoped map/global comparison required",
);
for (const [name, digest] of Object.entries(proof.sources))
  check(
    sha(await raw(`${root}/${name}`)) === digest,
    `Changed map resource source: ${name}`,
  );
for (const [path, digest] of Object.entries(proof.inputs))
  check(sha(await raw(path)) === digest, `Changed map resource input: ${path}`);
const inputBytes = await raw(`${assets}/latest-map-effect-inputs/package.json`),
  input = JSON.parse(new TextDecoder().decode(inputBytes));
check(
  sha(inputBytes) === meta.inputsPackageSha256 &&
    input.scope.staticBuildDataOnly &&
    !input.scope.containsReplayEvents &&
    !input.scope.mapVariantSelected &&
    !input.scope.guestSelected,
  "Build-only map input package required",
);
for (const [name, path, expected] of [
  [
    "/latest-map-effect-resources.mjs",
    `${root}/latest-map-effect-resources.mjs`,
    proof.sources["latest-map-effect-resources.mjs"],
  ],
  [
    "/assets/latest-map-effect-resources/package.json",
    `${assets}/latest-map-effect-resources/package.json`,
    MAP_EFFECT_RESOURCES_SHA,
  ],
  [
    "/assets/latest-map-effect-inputs/package.json",
    `${assets}/latest-map-effect-inputs/package.json`,
    meta.inputsPackageSha256,
  ],
  [
    `/assets/latest-map-effect-inputs/${input.source.file}`,
    `${assets}/latest-map-effect-inputs/${input.source.file}`,
    input.source.sha256,
  ],
  [
    `/assets/latest-map-effect-inputs/${meta.definitions.file}`,
    `${assets}/latest-map-effect-inputs/${meta.definitions.file}`,
    meta.definitions.sha256,
  ],
]) {
  const bytes = await raw(path);
  check(
    sha(bytes) === expected,
    `Changed map resource publication bytes: ${name}`,
  );
  files.set(name, { path, sha256: expected, bytes: bytes.length });
}
const viewer = new TextDecoder().decode(await raw(`${root}/latest-viewer.mjs`));
check(
  !viewer.includes("latest-map-effect-resources"),
  "Map resource publication needs a main viewer scope review",
);
let httpChecks = 0;
for (const base of [
  "http://127.0.0.1:4180",
  "https://desktop.tailnet-1a49.ts.net",
])
  for (const [path, ref] of files) {
    const response = await fetch(base + path, {
      signal: AbortSignal.timeout(15000),
    });
    check(
      response.status === 200 &&
        sha(new Uint8Array(await response.arrayBuffer())) === ref.sha256,
      `Private map resource HTTP bytes differ: ${base}${path}`,
    );
    httpChecks++;
  }
const result = {
  schema: 1,
  kind: "private-map-effect-resource-publication",
  files: Object.fromEntries(files),
  httpChecks,
  comparisonSha256: sha(proofBytes),
  counts: proof.counts,
  scope: {
    staticBuildDataOnly: true,
    libraryOnly: true,
    mainViewerEnabled: false,
    replayCatalogJoinOnly: true,
    activeMapVariantRecovered: false,
    activeGuestRecovered: false,
    worldFactoryExecuted: false,
    browserExecuted: false,
    referenceCompared: false,
  },
};
await Bun.write(
  `${cache}/research/map-effect-resources-publication.json`,
  JSON.stringify(result, null, 2),
);
console.log(
  JSON.stringify({ files: files.size, httpChecks, counts: proof.counts }),
);
