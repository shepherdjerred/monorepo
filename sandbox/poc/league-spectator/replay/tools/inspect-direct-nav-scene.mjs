import { resolve } from "node:path";
import { strict as assert } from "node:assert";
import { sha256 } from "../structural-comparison.mjs";
import { createLatestDirectNavScene } from "../latest-direct-nav-scene.mjs";
import {
  DIRECT_NAV_SCENE_POLICY,
  DIRECT_NAV_SCENE_PACKAGE_SHA,
} from "../latest-direct-nav-scene-contract.mjs";
import { directNavSceneMaterialAdmission } from "../latest-direct-nav-scene-material.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    digest = await sha256(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Nav world input drift: ${path}`);
  inputs[path] = digest;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const sceneManifestBytes = await raw(
    `${cache}/public/latest-scene/manifest.json`,
  ),
  sourcePackageBytes = await raw(
    `${cache}/public/latest-direct-nav-scene/package.json`,
  ),
  source = JSON.parse(new TextDecoder().decode(sourcePackageBytes)),
  view = await createLatestDirectNavScene({
    sceneManifestBytes,
    sourcePackageBytes,
    policy: DIRECT_NAV_SCENE_POLICY,
  }),
  native = await read(
    `${cache}/research/navmesh-producer-v29/native-high.json`,
  ),
  commandProof = await read(
    `${cache}/research/navmesh-producer-comparison.json`,
  ),
  materials = await read(
    `${cache}/public/latest-parent-native-materials/package.json`,
  );
assert.equal(await sha256(sourcePackageBytes), DIRECT_NAV_SCENE_PACKAGE_SHA);
for (const proof of [commandProof])
  for (const [path, digest] of Object.entries(proof.inputs))
    assert.equal(await sha256(await raw(path)), digest, path);
assert.equal(
  source.proofs.producerComparisonSha256,
  inputs[resolve(`${cache}/research/navmesh-producer-comparison.json`)],
);
const initialization = view.initialization(),
  nativeResult = native.result;
assert.equal(
  initialization.plan.upload.bytes.toHex(),
  nativeResult.r8Updates[2].pixelsHex,
);
assert.deepEqual(initialization.plan.passes[0].parameters, [
  0,
  0,
  0,
  Math.fround(1.1),
]);
let uniformBuffersCompared = 0;
for (const [index, time] of [0, 0.25, 0.5].entries()) {
  const frame = view.inspectFrame(view.frame({ time }));
  for (const [pass, command] of frame.plan.passes.entries()) {
    const draw = nativeResult.renderPasses[index * 5 + pass].draws[0];
    assert.equal(
      new Uint8Array(Float32Array.from(command.parameters).buffer).toHex(),
      draw.uniformBuffers[0].bytesHex,
    );
    uniformBuffersCompared++;
  }
}
const first = view.inspectFrame(view.frame({ time: 69 }));
view.frame({ time: 99 });
view.frame({ time: 0 });
const repeated = view.inspectFrame(view.frame({ time: 69 }));
assert.deepEqual(first.plan, repeated.plan);
assert.equal(first.transformBytes.toHex(), source.navigation.transformHex);
const actualReflections = [];
for (const [id, root] of Object.entries(materials.roots))
  for (const actor of Object.values(root.actors))
    for (const row of actor.rows)
      for (const variant of row.variants) {
        const result = directNavSceneMaterialAdmission({
          requiredScene: variant.requiredScene,
        });
        if (result.applicable) {
          assert.deepEqual(result.reasons, [
            "scene:nav-owned-world-resource-and-renderer-output",
          ]);
          actualReflections.push({
            id,
            emitter: actor.emitterIndex,
            passHash: row.hash,
            variant: variant.index,
            reasons: result.reasons,
          });
        }
      }
assert(actualReflections.length > 0);
for (const [path, digest] of Object.entries(inputs))
  assert.equal(await sha256(await Bun.file(path).bytes()), digest, path);
const output = `${cache}/research/direct-nav-scene-control.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "owned-selected-scene-nav-resource-contract-control",
      inputs,
      sourcePackageSha256: DIRECT_NAV_SCENE_PACKAGE_SHA,
      metadata: view.inspect(),
      counts: {
        initialUploadBytesCompared: initialization.plan.upload.bytes.length,
        uniformBuffersCompared,
        actualNativeMaterialReflections: actualReflections.length,
      },
      actualReflections,
      scope: {
        sourceMatchesActualSelectedScene: true,
        originalGetterTransformExact: true,
        explicitClockEpochShiftCompared: true,
        clockEpochNativeRecovered: false,
        cameraIndependent: true,
        backwardAndRepeatedSeek: true,
        gpuOutputSubmitted: false,
        materialAdmissionRequiresRealRendererOutput: true,
        runtimeAdmissionChanged: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    uniformBuffersCompared,
    actualNativeMaterialReflections: actualReflections.length,
    initialUploadBytesCompared: initialization.plan.upload.bytes.length,
    fingerprints: Object.keys(inputs).length,
  }),
);
