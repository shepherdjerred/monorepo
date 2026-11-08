import { resolve } from "node:path";
import {
  createSelectedNativeMaterialInventory,
  selectedNativeMaterialEmitterCount,
} from "../latest-selected-vfx-material-inventory.mjs";
import { createLatestVfxMaterials } from "../latest-vfx-materials.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { sha256 } from "../structural-comparison.mjs";
const [cacheArg, referenceArg] = process.argv.slice(2);
if (!cacheArg || !referenceArg || process.argv.length !== 4)
  throw Error(
    "Usage: inspect-selected-vfx-material-inventory.mjs <cache> <fixed-approved-native-material-reference>",
  );
const cache = resolve(cacheArg),
  decoder = resolve(cache, "public/decoder-16.21-macos"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = await sha256(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Selected material proof input drift");
  inputs[path] = hash;
  return bytes;
}
await captureDirectSourceInputs([import.meta.path], raw);
const approvedReferenceBytes = await raw(referenceArg),
  materialBytes = await raw(`${cache}/research/vfx-materials-native.json`),
  boundQuadBytes = await raw(`${decoder}/vfx-bound-quads.json`),
  imageBytes = await raw(`${decoder}/image.bin`),
  profile = JSON.parse(
    new TextDecoder().decode(await raw(`${decoder}/profile.json`)),
  ),
  meta = JSON.parse(new TextDecoder().decode(materialBytes)),
  args = {
    approvedReferenceBytes,
    materialBytes,
    boundQuadBytes,
    imageBytes,
    profile,
    loadGraph: (file) => raw(`${decoder}/${file}`),
  };
const token = await createSelectedNativeMaterialInventory(args),
  digest = await sha256(materialBytes),
  count = selectedNativeMaterialEmitterCount(token, {
    materialSha256: digest,
    profile,
  });
await createLatestVfxMaterials(materialBytes, digest, profile, token);
const rejections = [];
for (const [label, mutate] of [
  [
    "missing-selected-emitter",
    (m) => {
      m.emitters.pop();
      m.counts.emitters--;
      m.counts.shaderSelections -= 17;
    },
  ],
  [
    "different-selected-graph",
    (m) => (m.emitters[0].graphSha256 = "0".repeat(64)),
  ],
  ["missing-environment", (m) => m.emitters[0].probes.pop()],
  ["forged-original-result", (m) => (m.emitters[0].probes[0].result = -1)],
  ["native-code", (m) => (m.originalBlocks[0].sha256 = "0".repeat(64))],
  [
    "native-algorithm",
    (m) => (m.sources[Object.keys(m.sources)[0]] = "0".repeat(64)),
  ],
]) {
  const value = structuredClone(meta);
  mutate(value);
  let reason = null;
  try {
    await createSelectedNativeMaterialInventory({
      ...args,
      materialBytes: new TextEncoder().encode(JSON.stringify(value)),
    });
  } catch (error) {
    reason = error.message;
  }
  if (!reason)
    throw Error("Invalid selected material corpus accepted: " + label);
  rejections.push({ label, rejected: true, reason });
}
for (const [label, call] of [
  [
    "lookalike-owner",
    () =>
      selectedNativeMaterialEmitterCount(
        { ...token },
        { materialSha256: digest, profile },
      ),
  ],
  [
    "changed-material-bytes",
    () =>
      selectedNativeMaterialEmitterCount(token, {
        materialSha256: "0".repeat(64),
        profile,
      }),
  ],
  [
    "changed-profile",
    () =>
      selectedNativeMaterialEmitterCount(token, {
        materialSha256: digest,
        profile: { ...profile, vfxBoundQuadsSha256: "0".repeat(64) },
      }),
  ],
]) {
  let reason = null;
  try {
    call();
  } catch (error) {
    reason = error.message;
  }
  if (!reason) throw Error("Selected owner identity mismatch accepted");
  rejections.push({ label, rejected: true, reason });
}
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error("Final selected material proof drift: " + path);
const output = resolve(
  cache,
  "research/selected-vfx-material-inventory-control.json",
);
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "selected-complete-original-material-inventory-control",
      inputs,
      emitters: count,
      selections: count * 17,
      rejections,
      scope: {
        fixedNativeAlgorithmAndEntrypoints: true,
        completeSelectedGraphAndSourceInventory: true,
        serializedPointerMaskDerivesEnvironment: true,
        all17NativeEnvironmentsPerEmitter: true,
        exactNativeImageBlocks: true,
        ownedPackageAndProfileIdentity: true,
        primaryLiteralCorpusDefaultRetained: true,
        nativeResourceAcquisition: false,
        gpuSubmission: false,
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
    emitters: count,
    selections: count * 17,
    rejections: rejections.length,
    inputs: Object.keys(inputs).length,
  }),
);
