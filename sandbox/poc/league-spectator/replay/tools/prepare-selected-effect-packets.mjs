import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import {
  EFFECT_PLACEMENT_PACKAGE_SHA,
  EFFECT_DESCRIPTOR_PACKAGE_SHA,
} from "../latest-effect-packet-contract.mjs";
import { EFFECT_CREATION_PACKAGE_SHA } from "../latest-effect-creation.mjs";
import { assertEffectPacketSceneRebinding } from "../latest-selected-effect-packets.mjs";
import { stringifyAssetJson } from "./asset-json.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const [sourceArg, targetArg] = process.argv.slice(2);
if (!sourceArg || !targetArg || process.argv.length !== 4)
  throw Error(
    "Usage: bun prepare-selected-effect-packets.mjs <approved-source-cache> <selected-cache>",
  );
const source = resolve(sourceArg),
  target = resolve(targetArg),
  inputs = {},
  outputs = {};
if (
  source === target ||
  /[\\/]hs(?:[\\/]|$)/i.test(source) ||
  /[\\/]hs(?:[\\/]|$)/i.test(target)
)
  throw Error("Distinct static preparation roots outside hs required");
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    digest = await sha256(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error("Packet preparation input changed");
  inputs[path] = digest;
  return bytes;
}
const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
await captureDirectSourceInputs([import.meta.path], raw);
const sceneBytes = await raw(`${target}/public/latest-scene/manifest.json`),
  sceneHash = await sha256(sceneBytes),
  scene = decode(sceneBytes);
const profile = decode(
  await raw(`${target}/public/decoder-16.21-macos/profile.json`),
);
if (
  scene.build !== profile.clientVersion ||
  scene.protocol !== profile.protocolDigest ||
  scene.build !== "16.21.829.8620" ||
  scene.protocol !== "20e09df23c66b85e"
)
  throw Error("Exact-build selected scene required");
async function write(path, bytes) {
  await Bun.write(path, bytes);
  const expected = await sha256(bytes);
  if ((await sha256(await Bun.file(path).bytes())) !== expected)
    throw Error("Selected packet package readback differs");
  outputs[resolve(path)] = expected;
}
for (const [kind, directory, digest] of [
  ["placement", "latest-effect-placement", EFFECT_PLACEMENT_PACKAGE_SHA],
  ["descriptor", "latest-effect-descriptor", EFFECT_DESCRIPTOR_PACKAGE_SHA],
]) {
  const referenceBytes = await raw(
    `${source}/public/${directory}/package.json`,
  );
  if ((await sha256(referenceBytes)) !== digest)
    throw Error("Fixed approved effect packet reference required");
  const reference = decode(referenceBytes),
    selected = { ...reference, sceneManifestSha256: sceneHash };
  if (
    reference.decoderImageSha256 !== profile.decoderImageSha256 ||
    reference.constructorImageSha256 !== profile.constructorImageSha256
  )
    throw Error(
      "Selected packet original decoder/constructor identity differs",
    );
  assertEffectPacketSceneRebinding(kind, reference, selected, scene, sceneHash);
  await write(
    `${target}/public/latest-static-catalog/effect-${kind}-reference.json`,
    referenceBytes,
  );
  await write(
    `${target}/public/${directory}/package.json`,
    new TextEncoder().encode(stringifyAssetJson(selected, 2)),
  );
}
const creation = await raw(
  `${source}/public/latest-effect-creation/package.json`,
);
if ((await sha256(creation)) !== EFFECT_CREATION_PACKAGE_SHA)
  throw Error("Fixed original effect creation codec required");
const creationPath = `${target}/public/latest-effect-creation/package.json`;
if (await Bun.file(creationPath).exists()) {
  if (
    (await sha256(await Bun.file(creationPath).bytes())) !==
    EFFECT_CREATION_PACKAGE_SHA
  )
    throw Error("Differing selected creation codec cannot be replaced");
} else await write(creationPath, creation);
outputs[resolve(creationPath)] = EFFECT_CREATION_PACKAGE_SHA;
for (const [path, expected] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== expected)
    throw Error("Packet preparation source changed before publication");
const output = `${target}/research/selected-effect-packets-preparation.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "scene-only-original-effect-packet-preparation",
      inputs,
      outputs,
      scope: {
        originalPacketProgramsUnchanged: true,
        mapQuantizationUnchanged: true,
        nativeExecutionPerformed: false,
        replayEventsPrepared: false,
        instancePlacementEstablished: false,
        renderingEstablished: false,
      },
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ output, outputs }));
