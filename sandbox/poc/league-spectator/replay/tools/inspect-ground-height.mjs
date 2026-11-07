// Compare the browser-compatible height sampler with executed original code.
import { resolve } from "node:path";
import { createLatestTerrain } from "../latest-terrain.mjs";
import { initializeLatestMissileTarget } from "../latest-missiles.mjs";

const [scenePath, nativePath, outputPath, missilePath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-ground-height.mjs <scene-dir> <native-height.json> <evidence.json> [missile-analysis.json]",
  );
const scene = resolve(scenePath),
  manifestBytes = await Bun.file(`${scene}/manifest.json`).arrayBuffer(),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes)),
  heightBytes = await Bun.file(`${scene}/heights.bin`).arrayBuffer(),
  heights = new Float32Array(heightBytes),
  nativeBytes = await Bun.file(nativePath).arrayBuffer(),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  hash = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
if (
  native.schema !== 1 ||
  native.build !== manifest.build ||
  native.protocol !== manifest.protocol ||
  native.sceneManifestSha256 !== hash(manifestBytes) ||
  native.heightsSha256 !== hash(heightBytes) ||
  native.navgridSha256 !== manifest.map.heightGrid.sourceSha256 ||
  native.loader.preparedSamplesMatch !== true ||
  native.loader.heightSamples !== heights.length ||
  native.loader.entryRva !== 0x16bd650 ||
  native.loader.stopRva !== 0x16bdcfd
)
  throw Error("Native terrain comparison package mismatch");
const terrain = createLatestTerrain(manifest, heights),
  bits = new DataView(new ArrayBuffer(4)),
  mismatches = [],
  kinds = {};
let outside = 0,
  oldHeightDifferences = 0,
  largestOldHeightDifference = 0,
  newlyAdmittedEdgeSamples = 0;
for (const sample of native.cases) {
  const actual = terrain.sampleHeight(sample.x, sample.z);
  kinds[sample.kind] = (kinds[sample.kind] ?? 0) + 1;
  bits.setFloat32(0, actual.height, true);
  const actualBits = actual.inside ? bits.getUint32(0, true) : null;
  if (actual.inside !== sample.inside || actualBits !== sample.heightBits)
    mismatches.push({ ...sample, actual, actualBits });
  if (!actual.inside) {
    outside++;
    continue;
  }
  // Quantify the previous viewer's double-precision interpolation separately.
  const grid = manifest.map.heightGrid,
    ix = (sample.x - manifest.map.min[0]) / grid.step[0],
    iz = (sample.z - manifest.map.min[2]) / grid.step[1];
  if (ix < 0 || iz < 0 || ix >= grid.x - 1 || iz >= grid.z - 1) {
    newlyAdmittedEdgeSamples++;
    continue;
  }
  const a = Math.floor(ix),
    b = Math.floor(iz),
    u = ix - a,
    v = iz - b,
    previous =
      (1 - v) *
        ((1 - u) * heights[b * grid.x + a] + u * heights[b * grid.x + a + 1]) +
      v *
        ((1 - u) * heights[(b + 1) * grid.x + a] +
          u * heights[(b + 1) * grid.x + a + 1]);
  bits.setFloat32(0, previous, true);
  if (bits.getUint32(0, true) !== sample.heightBits) oldHeightDifferences++;
  largestOldHeightDifference = Math.max(
    largestOldHeightDifference,
    Math.abs(previous - actual.height),
  );
}
const cellMismatches = [],
  targetMismatches = [];
for (const sample of native.cellCases) {
  const actual = terrain.sameMovementCell(sample.first, sample.second);
  if (actual !== sample.same) cellMismatches.push({ ...sample, actual });
}
if (native.targetCases.length || native.deferredTargets.length) {
  if (!missilePath)
    throw Error("Native target evidence requires its missile-analysis input");
  const bytes = await Bun.file(missilePath).arrayBuffer();
  if (hash(bytes) !== native.missileInputsSha256)
    throw Error("Native target evidence differs from missile-analysis input");
  const analysis = JSON.parse(new TextDecoder().decode(bytes)),
    records = new Map(
      analysis.records.map((record) => [record.sequence, record]),
    ),
    vectorBits = (values) =>
      Array.from(new Uint32Array(new Float32Array(values).buffer));
  for (const sample of native.targetCases) {
    const record = records.get(sample.sequence);
    if (
      !record ||
      record.cast.sourcePosition.some((n, i) => n !== sample.source[i]) ||
      record.cast.targetPosition.some((n, i) => n !== sample.target[i])
    )
      throw Error("Native target probe differs from recorded cast fields");
    const actual = initializeLatestMissileTarget(
        record,
        sample.settings,
        terrain,
      ),
      recorded = record.targetInitialization;
    if (
      actual.status !== "initialized" ||
      recorded.status !== "initialized" ||
      JSON.stringify(vectorBits(actual.position)) !==
        JSON.stringify(sample.positionBits) ||
      JSON.stringify(vectorBits(recorded.position)) !==
        JSON.stringify(sample.positionBits)
    )
      targetMismatches.push({ ...sample, actual, recorded });
  }
  for (const sample of native.deferredTargets) {
    const actual = records.get(sample.sequence)?.targetInitialization.status,
      expected =
        sample.reason === "cast-range-projection"
          ? "unresolved-cast-range-projection"
          : "unresolved-facing-derived-endpoint";
    if (actual !== expected)
      targetMismatches.push({ ...sample, actual, expected });
  }
}
const evidence = {
  schema: 1,
  build: manifest.build,
  protocol: manifest.protocol,
  nativeEvidenceSha256: hash(nativeBytes),
  samplerSourceSha256: hash(
    await Bun.file(
      new URL("../latest-terrain.mjs", import.meta.url),
    ).arrayBuffer(),
  ),
  decoderImageSha256: native.decoderImageSha256,
  sceneManifestSha256: native.sceneManifestSha256,
  navgridSha256: native.navgridSha256,
  heightsSha256: native.heightsSha256,
  loader: native.loader,
  matched: native.cases.length - mismatches.length,
  mismatches,
  outsideMap: outside,
  kinds,
  movementOrigin: native.movementOrigin,
  cellComparison: {
    matched: native.cellCases.length - cellMismatches.length,
    mismatches: cellMismatches,
  },
  initialTargets: {
    matched:
      native.targetCases.length -
      targetMismatches.filter((x) => x.positionBits).length,
    deferred: native.deferredTargets.length,
    mismatches: targetMismatches,
  },
  targetInitializerSourceSha256: hash(
    await Bun.file(
      new URL("../latest-missiles.mjs", import.meta.url),
    ).arrayBuffer(),
  ),
  missileInputsSha256: native.missileInputsSha256,
  previousViewer: {
    float32ResultDifferences: oldHeightDifferences,
    largestAbsoluteHeightDifference: largestOldHeightDifference,
    newlyAdmittedEdgeSamples,
  },
  scope:
    "Bit-exact agreement with original partial navgrid loader, ground-height query, movement-cell comparison and nonprojected/nondegenerate fixed-speed initial targets; no complete trajectories, game runtime, browser UI or A/V validation",
};
await Bun.write(outputPath, JSON.stringify(evidence, null, 2));
console.log(
  JSON.stringify({
    matched: evidence.matched,
    mismatches: mismatches.length,
    outsideMap: outside,
    loadedHeightSamples: native.loader.heightSamples,
    movementCells: evidence.cellComparison.matched,
    initialTargets: evidence.initialTargets,
    previousViewer: evidence.previousViewer,
  }),
);
if (mismatches.length || cellMismatches.length || targetMismatches.length)
  throw Error("Native/browser terrain or initial-target disagreement");
