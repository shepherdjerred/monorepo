// Original controller-component comparison, not a complete playback admission.
import { resolve } from "node:path";
import { createLatestMissileControllers } from "../latest-missile-controllers.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";

const [packagePath, scenePath, nativePath, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-missile-controllers.mjs <decoder-dir> <scene-dir> <native-components.json> <evidence.json>",
  );
const decoder = resolve(packagePath),
  scene = resolve(scenePath),
  profile = await Bun.file(`${decoder}/profile.json`).json(),
  definitionBytes = await Bun.file(
    `${decoder}/missile-controllers.json`,
  ).arrayBuffer(),
  manifestBytes = await Bun.file(`${scene}/manifest.json`).arrayBuffer(),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes)),
  heights = await Bun.file(`${scene}/heights.bin`).arrayBuffer(),
  nativeBytes = await Bun.file(nativePath).arrayBuffer(),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  hash = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
if (
  native.build !== profile.clientVersion ||
  native.build !== manifest.build ||
  native.protocol !== manifest.protocol ||
  native.protocol !== profile.protocolDigest ||
  native.decoderImageSha256 !== profile.decoderImageSha256 ||
  native.controllerDefinitionSha256 !== profile.missileControllersSha256 ||
  hash(definitionBytes) !== profile.missileControllersSha256 ||
  hash(manifestBytes) !== native.sceneManifestSha256 ||
  hash(heights) !== native.heightsSha256 ||
  native.externalMath.symbol !== "_powf" ||
  native.externalMath.stubRva !== 0x1feeb3a ||
  native.externalMath.originalMacosImplementationVerified !== false
)
  throw Error("Native missile-component comparison package mismatch");
const controllers = createLatestMissileControllers(
    JSON.parse(new TextDecoder().decode(definitionBytes)),
  ),
  terrain = createLatestTerrain(manifest, new Float32Array(heights)),
  mismatches = [],
  scalarBits = (n) => new Uint32Array(new Float32Array([n]).buffer)[0],
  vectorBits = (n) => Array.from(new Uint32Array(new Float32Array(n).buffer));
let arrivalMatches = 0,
  snapMatches = 0,
  progressMatches = 0,
  followMatches = 0,
  blendedAdapterMatches = 0;
for (const sample of native.cases) {
  const arrival = controllers.fixedSpeedArrival(
      sample.position,
      sample.target,
      sample.displacement,
      sample.radius,
      sample.canPassOnce,
    ),
    displacement = arrival.arrived
      ? controllers.snapDisplacement(
          sample.position,
          sample.target,
          sample.displacement,
          sample.radius,
        )
      : sample.displacement,
    predicted = sample.position.map((n, i) =>
      Math.fround(Math.fround(n) + Math.fround(displacement[i])),
    ),
    progress = controllers.fixedSpeedProgress(
      sample.start,
      sample.target,
      predicted,
      arrival.arrived,
    );
  const errors = [];
  if (
    arrival.arrived !== sample.arrived ||
    arrival.canPassOnce !== sample.canPassAfter
  )
    errors.push("arrival-state");
  else arrivalMatches++;
  if (
    JSON.stringify(vectorBits(displacement)) !==
    JSON.stringify(sample.finalDisplacementBits)
  )
    errors.push("terminal-displacement");
  else snapMatches++;
  if (scalarBits(progress) !== sample.progressBits) errors.push("progress");
  else progressMatches++;
  let height = null;
  if (sample.heightController.type === "FollowTerrainHeightSolver") {
    height = controllers.followTerrainHeight(
      sample.position,
      predicted,
      sample.heightController.settings,
      terrain,
    );
    if (scalarBits(height) !== sample.heightBits)
      errors.push("follow-terrain-height");
    else followMatches++;
  } else if (sample.heightController.type === "BlendedLinearHeightSolver") {
    height = controllers.blendedLinearHeight(
      sample.start,
      sample.target,
      predicted,
      progress,
      terrain,
    );
    if (scalarBits(height) !== sample.heightBits)
      errors.push("blended-height-vs-windows-powf-adapter");
    else blendedAdapterMatches++;
  } else if (sample.heightBits !== null)
    throw Error("Unprepared native height component");
  if (errors.length)
    mismatches.push({
      sequence: sample.sequence,
      errors,
      sample,
      actual: {
        arrival,
        displacement,
        predicted,
        progress,
        progressBits: scalarBits(progress),
        height,
        heightBits: height === null ? null : scalarBits(height),
      },
    });
}
const evidence = {
  schema: 1,
  build: native.build,
  protocol: native.protocol,
  decoderImageSha256: native.decoderImageSha256,
  controllerDefinitionSha256: native.controllerDefinitionSha256,
  nativeEvidenceSha256: hash(nativeBytes),
  missileInputsSha256: native.missileInputsSha256,
  terrainEvidenceSha256: native.terrainEvidenceSha256,
  controllerSourceSha256: hash(
    await Bun.file(
      new URL("../latest-missile-controllers.mjs", import.meta.url),
    ).arrayBuffer(),
  ),
  cases: native.cases.length,
  arrivalMatches,
  snapMatches,
  progressMatches,
  followTerrainMatches: followMatches,
  blendedWindowsAdapterMatches: blendedAdapterMatches,
  externalMath: native.externalMath,
  mismatches,
  scope:
    "Original arrival/snap/progress and terrain-following components match browser-compatible functions on owned vector probes. Blended height matches native surrounding code with Windows CRT powf adapter; original macOS powf, complete trajectories and rendered A/V remain unverified",
};
await Bun.write(outputPath, JSON.stringify(evidence, null, 2));
console.log(
  JSON.stringify({
    cases: evidence.cases,
    arrivalMatches,
    snapMatches,
    progressMatches,
    followTerrainMatches: followMatches,
    blendedWindowsAdapterMatches: blendedAdapterMatches,
    mismatches: mismatches.length,
  }),
);
if (mismatches.length)
  throw Error("Native/browser missile-component disagreement");
