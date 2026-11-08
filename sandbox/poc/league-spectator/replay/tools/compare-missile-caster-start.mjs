// Standalone oracle comparison only. Ordinary missile admission is unchanged.
import { resolve } from "node:path";
import { initializeEmptyBoneCasterStart } from "../latest-missile-caster-start.mjs";
import { VIEWER_ROOT_POLICY } from "../latest-world-presentation.mjs";
import { createLatestTerrain } from "../latest-terrain.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
const raw = async (path) => {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Caster source changed: " + path);
  inputs[path] = hash;
  return bytes;
};
const read = async (path) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const native = await read(`${cache}/research/missile-caster-start-native.json`);
for (const [path, hash] of Object.entries(native.inputs))
  if ((await sha256(await raw(path))) !== hash)
    throw Error("Native caster proof input changed: " + path);
const scene = await read(`${cache}/public/latest-scene/manifest.json`),
  heightBytes = await raw(`${cache}/public/latest-scene/heights.bin`);
if (
  scene.build !== native.build ||
  scene.protocol !== native.protocol ||
  native.originalTerrainAugment !== 100 ||
  native.rigEmptyKey.found !== false ||
  native.rigEmptyKey.outputUnchanged !== true ||
  native.scope.runtimeAdmissionChanged !== false
)
  throw Error("Scoped original caster-root/empty-key evidence required");
const terrain = createLatestTerrain(
  scene,
  new Float32Array(
    heightBytes.buffer,
    heightBytes.byteOffset,
    heightBytes.byteLength / 4,
  ),
);
const rigBytes = await raw(
  `${cache}/public/latest-scene/${native.rigEmptyKey.rigPath}`,
);
const results = [];
for (const sample of native.cases) {
  const result = initializeEmptyBoneCasterStart({
    record: {
      time: sample.time,
      cast: {
        ownerId: sample.ownerId,
        forceRecordedSourcePosition: false,
        overrideFlag14d: 0,
      },
    },
    settings: sample.settings,
    sourceBoneName: sample.sourceBoneName,
    root: {
      resolved: true,
      policy: VIEWER_ROOT_POLICY,
      entityId: sample.ownerId,
      time: sample.time,
      position: sample.suppliedWorldRoot,
      positionStatus: sample.sourceQuery.positionStatus,
      lifecycle: "alive",
      omissions: [],
    },
    rig: {
      build: native.build,
      protocol: native.protocol,
      rigSha256: await sha256(rigBytes),
      resolvedBoneKeys: native.rigEmptyKey.resolvedBoneKeys,
    },
    terrain,
  });
  if (
    !result.resolved ||
    !result.position.every((lane, i) => Object.is(lane, sample.position[i])) ||
    !Object.is(result.planeHeightOffset, sample.planeHeightOffset) ||
    !Object.is(result.attachmentHeightOffset, sample.attachmentHeightOffset)
  )
    throw Error(
      "Original caster-root initialization differs: " + sample.sequence,
    );
  results.push({
    sequence: sample.sequence,
    sourceEventId: sample.sourceEventId,
    offset: sample.rootOffsetControl,
    position: result.position,
  });
}
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error("Caster comparison input changed: " + path);
const output = `${cache}/research/missile-caster-start-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "standalone-caster-start-original-comparison",
      inputs,
      cases: results,
      mismatches: 0,
      scope: {
        exactFloat32Equality: true,
        suppliedWorldRootFixture: true,
        currentWorldReconstructionCertified: false,
        runtimeAdmissionChanged: false,
        nativeMatchAcceptance: null,
        browserAcceptance: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    cases: results.length,
    lanesCompared: results.length * 5,
    mismatches: 0,
  }),
);
