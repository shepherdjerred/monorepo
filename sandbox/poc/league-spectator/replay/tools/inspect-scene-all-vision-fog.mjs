import path from "node:path";
import assert from "node:assert/strict";
import {
  createSceneAllVisionFog,
  describeOriginalAllVisionFogProofs,
  isSceneAllVisionFog,
} from "../scene-all-vision-fog.mjs";
import { prepareNativeParticleGpuBinding } from "../latest-native-particle-gpu-binding.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const [approvedArg, sceneArg, authorityArg, outputArg] = process.argv.slice(2);
if (!outputArg)
  throw Error(
    "Usage: bun inspect-scene-all-vision-fog.mjs <approved-cache> <scene-root> <fog-authority-root> <fresh-output.json>",
  );
if (await Bun.file(outputArg).exists())
  throw Error("Fresh all-vision control output required");
const inputs = {};
async function raw(file) {
  const bytes = await Bun.file(file).bytes();
  inputs[path.resolve(file)] = sha(bytes);
  return bytes;
}
await captureDirectSourceInputs([import.meta.path], raw);
const value = {
  manifestBytes: await raw(path.join(authorityArg, "manifest.json")),
  sceneBytes: await raw(path.join(sceneArg, "manifest.json")),
  worldBytes: await raw(path.join(sceneArg, "world.json")),
  baseProfileBytes: await raw(
    path.join(approvedArg, "public/decoder-16.21-macos/profile.json"),
  ),
  imageBytes: await raw(
    path.join(approvedArg, "public/decoder-16.21-macos/image.bin"),
  ),
  readResource: (file) => raw(path.join(authorityArg, file)),
  perspective: "all",
};
const api = await createSceneAllVisionFog(value);
assert(isSceneAllVisionFog(api));
assert(!isSceneAllVisionFog({ ...api }));
assert.deepEqual(api.binding().sampler, { name: "clamp", pixelated: false });
assert.deepEqual(api.binding().rgba, [255, 255, 255, 255]);
let negatives = 0;
for (const perspective of [undefined, "blue", "red"]) {
  await assert.rejects(
    () => createSceneAllVisionFog({ ...value, perspective }),
    /Explicit supported/,
  );
  negatives++;
}
for (const field of [
  "sceneBytes",
  "worldBytes",
  "baseProfileBytes",
  "imageBytes",
]) {
  const changed = { ...value, [field]: value[field].slice() };
  // JSON parents remain parseable while their exact bytes change.
  if (field === "imageBytes") changed[field][0] ^= 1;
  else changed[field] = new Uint8Array([...changed[field], 32]);
  await assert.rejects(
    () => createSceneAllVisionFog(changed),
    /parent differs/,
  );
  negatives++;
}
const proofBytes = await value.readResource("resource-proof.json"),
  extentBytes = await value.readResource("extent-proof.json");
for (const mutate of [
  (p) => {
    p.fowResourceExtension.controllerReads.push({ address: 1, bytes: 8 });
  },
  (p) => {
    p.fowResourceExtension.samplerProof.gpu.parameters[10240] = 9728;
  },
  (p) => {
    p.fowResourceExtension.selectedResource.readbacks[0].sha256 = "0".repeat(
      64,
    );
  },
  (p) => {
    p.fowResourceExtension.scope.shaderFogModeChanged = true;
  },
  (p) => {
    p.fowResourceExtension.extentProofSha256 = "0".repeat(64);
  },
  (p) => {
    p.sources["probe-original-fow-material-resources.py"] = "0".repeat(64);
  },
]) {
  const changed = JSON.parse(new TextDecoder().decode(proofBytes));
  mutate(changed);
  await assert.rejects(() =>
    describeOriginalAllVisionFogProofs(
      new TextEncoder().encode(JSON.stringify(changed)),
      extentBytes,
    ),
  );
  negatives++;
}
await assert.rejects(
  () =>
    prepareNativeParticleGpuBinding(null, null, { allVisionFog: { ...api } }),
  /Owned original/,
);
negatives++;
const binding = api.binding();
binding.rgba[0] = 0;
assert.deepEqual(api.binding().rgba, [255, 255, 255, 255]);
for (const [file, digest] of Object.entries(inputs))
  assert.equal(
    sha(await Bun.file(file).bytes()),
    digest,
    "All-vision control source changed",
  );
const result = {
  schema: 1,
  kind: "owned-scene-all-vision-fog-control",
  authority: api.describe(),
  negativeControls: negatives,
  inputs,
  scope: {
    ownedNativeResourceAndSampler: true,
    originalMap11Uniform: true,
    shaderFogModeChanged: false,
    teamVisionAdmitted: false,
    webGlSubmitted: false,
    nativeSpectatorAdmitted: false,
  },
};
await Bun.write(outputArg, JSON.stringify(result));
console.log(
  JSON.stringify({
    output: outputArg,
    negativeControls: negatives,
    authority: api.describe().authoritySha256,
  }),
);
