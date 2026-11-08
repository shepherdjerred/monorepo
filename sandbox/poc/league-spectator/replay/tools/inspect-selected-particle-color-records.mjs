import { resolve } from "node:path";
import { loadNativeParticleColorBindings } from "./particle-color-bindings.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import { sha256 } from "../structural-comparison.mjs";
const [cacheArg, referenceArg] = process.argv.slice(2);
if (!cacheArg || !referenceArg || process.argv.length !== 4)
  throw Error(
    "Usage: inspect-selected-particle-color-records.mjs <cache> <fixed-approved-color-reference>",
  );
const cache = resolve(cacheArg),
  assets = resolve(cache, "public"),
  packagePath = resolve(assets, "latest-particle-color/package.json"),
  inputs = {},
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex");
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    hash = sha(bytes);
  if (inputs[path] && inputs[path] !== hash)
    throw Error("Selected color proof input changed");
  inputs[path] = hash;
  return bytes;
}
await captureDirectSourceInputs([import.meta.path], raw);
const referenceBytes = await raw(referenceArg),
  packageBytes = await raw(packagePath),
  meta = JSON.parse(new TextDecoder().decode(packageBytes));
const entries = await loadNativeParticleColorBindings({
    assets,
    raw,
    sha,
    selectedReferenceBytes: referenceBytes,
  }),
  rejections = [];
for (const [label, mutate] of [
  [
    "descriptor",
    (m) =>
      (m.entries[0].descriptorHex =
        m.entries[0].descriptorHex === "0101010000"
          ? "0101010101"
          : "0101010000"),
  ],
  [
    "missing-native-record",
    (m) => {
      m.entries.pop();
      m.counts.emitters--;
    },
  ],
  [
    "source-definition",
    (m) => (m.entries[0].sourceDefinitionSha256 = "0".repeat(64)),
  ],
  ["source-graph", (m) => (m.entries[0].graphSha256 = "0".repeat(64))],
  ["texture-bytes", (m) => (m.entries[0].asset.sha256 = "0".repeat(64))],
  [
    "missing-observation-input",
    (m) => delete m.inputs[Object.keys(m.inputs)[0]],
  ],
  ["native-code-approval", (m) => (m.sourceBlocks[0].sha256 = "0".repeat(64))],
  ["native-scope", (m) => (m.scope.nativeFactoryExecuted = true)],
]) {
  const changed = structuredClone(meta);
  mutate(changed);
  const bytes = new TextEncoder().encode(JSON.stringify(changed));
  let reason = null;
  try {
    await loadNativeParticleColorBindings({
      assets,
      raw: async (path) => (resolve(path) === packagePath ? bytes : raw(path)),
      sha,
      selectedReferenceBytes: referenceBytes,
    });
  } catch (error) {
    reason = error.message;
  }
  if (reason === null)
    throw Error("Selected forged native color record was accepted: " + label);
  rejections.push({ label, rejected: true, reason });
}
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error(
      "Final selected color proof drift: " +
        path +
        " expected=" +
        hash +
        " actual=" +
        (await sha256(await Bun.file(path).bytes())),
    );
const output = resolve(
    cache,
    "research/selected-particle-color-records-control.json",
  ),
  result = {
    schema: 1,
    kind: "selected-original-particle-color-record-source-closure",
    inputs,
    entries: entries.size,
    primitiveKinds: [
      ...new Set([...entries.values()].map((e) => e.primitiveKind)),
    ].sort(),
    samplerDescriptors: [
      ...new Set([...entries.values()].map((e) => e.descriptorHex)),
    ].sort(),
    rejections,
    scope: {
      fixedOriginalAlgorithmApproval: true,
      completeSelectedRecordInventory: true,
      originalSerializedPixelatedFlagByteVerified: true,
      originalStringPointerAndLengthVerified: true,
      originalSlot1SamplerPrefixDerived: true,
      selectedNativeObservationInputsComplete: true,
      primaryPackagePinUnchanged: true,
      sourceTextureBytesChecked: true,
      textureAcquisitionExecuted: false,
      nativeFactoryAcceptance: false,
      gpuSubmission: false,
      browserAcceptance: false,
    },
  };
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output,
    entries: entries.size,
    rejections: rejections.length,
    inputs: Object.keys(inputs).length,
    sha256: sha(await Bun.file(output).bytes()),
  }),
);
