import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { compareDirectChildSiblingControls } from "../latest-direct-child-sibling-control.mjs";

const cache = path.resolve(process.argv[2] ?? ".cache/replay-spike");
const inputs = {};
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function raw(file, expected = null) {
  const absolute = path.resolve(file),
    bytes = await readFile(absolute),
    digest = sha(bytes);
  if (expected !== null && digest !== expected)
    throw new Error(`Child sibling proof input drift: ${absolute}`);
  inputs[absolute] = digest;
  return bytes;
}
async function json(file, expected = null) {
  return JSON.parse(await raw(file, expected));
}
const root = path.dirname(fileURLToPath(import.meta.url));
for (const source of [
  fileURLToPath(import.meta.url),
  path.join(root, "../latest-direct-child-sibling-control.mjs"),
  path.join(root, "../latest-direct-child-sibling-control.test.mjs"),
])
  await raw(source);
const profile = await json(
  path.join(cache, "public/decoder-16.21-macos/profile.json"),
);
const image = await raw(
  path.join(cache, "public/decoder-16.21-macos/image.bin"),
  profile.decoderImageSha256,
);
const manifest = await json(
  path.join(cache, "public/latest-effects/manifest.json"),
);
const results = [];
for (const effectId of [
  "champions/akshan/20/14ad5334",
  "champions/jinx/2/3b1dfaaf",
]) {
  const pair = [];
  for (const variant of ["authored", "typed-child-null"]) {
    const native = await json(
      path.join(
        cache,
        `research/direct-child-siblings-${effectId.replaceAll("/", "-")}-${variant}-native.json`,
      ),
    );
    for (const [file, digest] of Object.entries({
      ...native.inputs,
      ...native.sources,
    }))
      await raw(file, digest);
    if (!native.originalBlocks.length)
      throw new Error("No original observation blocks");
    for (const block of native.originalBlocks) {
      if (
        !Number.isInteger(block.rva) ||
        !Number.isInteger(block.size) ||
        block.rva < 0 ||
        block.rva + block.size > image.length ||
        sha(image.subarray(block.rva, block.rva + block.size)) !== block.sha256
      )
        throw new Error("Original child sibling block mismatch");
    }
    if (
      native.build !== profile.clientVersion ||
      native.protocol !== profile.protocolDigest
    )
      throw new Error("Child sibling build mismatch");
    pair.push(native);
  }
  const source = manifest.definitions[effectId];
  const authored = await json(
    path.join(cache, "public/latest-effects", source.file),
    source.sha256,
  );
  const definitions = authored.definition.complexEmitterDefinitionData;
  if (
    pair[0].siblingIndices.some((index) => {
      const emitter = definitions[index];
      return (
        emitter?.__type !== "VfxEmitterDefinitionData" ||
        (emitter.primitive !== undefined &&
          !["VfxPrimitiveCameraQuad", "VfxPrimitiveArbitraryQuad"].includes(
            emitter.primitive.__type,
          ))
      );
    })
  )
    throw new Error(
      "Selected native siblings must use the observed quad family",
    );
  const childIndices = definitions.flatMap((emitter, index) =>
    emitter.childParticleSetDefinition ? [index] : [],
  );
  if (
    !childIndices.length ||
    pair[0].siblingIndices.some((index) => childIndices.includes(index)) ||
    JSON.stringify(childIndices) !==
      JSON.stringify(
        pair[1].details.typedChildControls.map((value) => value.emitterIndex),
      )
  )
    throw new Error(
      "Typed-null override must cover exactly all authored child declarations and no selected sibling",
    );
  results.push({
    ...compareDirectChildSiblingControls(...pair),
    childIndices,
    sourceDefinitionSha256: source.sha256,
    originalBlocks: pair.map((value) => value.originalBlocks.length),
    authoredSuccessfulChildLookups: pair[0].lookupSuccesses.length,
    authoredOriginalChildFactories: pair[0].factories.length - 1,
  });
}
for (const [file, digest] of Object.entries(inputs))
  if (sha(await readFile(file)) !== digest)
    throw new Error(`Final child sibling input drift: ${file}`);
const output = path.join(
  cache,
  "research/direct-child-sibling-comparison.json",
);
const report = {
  schema: 1,
  kind: "native-paired-child-free-sibling-comparison",
  build: profile.clientVersion,
  protocol: profile.protocolDigest,
  passed: results.every((value) => value.matched),
  results,
  inputs,
  scope: {
    authoredVersusOriginalTypedNull: true,
    childSchedulerActivationRecovered: false,
    nativeReplayAcceptance: null,
    nativeParentCompletionRecovered: false,
    productionAdmissionChanged: false,
  },
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      output,
      passed: report.passed,
      results: results.map(({ effectId, matched, counts, differences }) => ({
        effectId,
        matched,
        counts,
        differences: differences.slice(0, 12),
      })),
      inputs: Object.keys(inputs).length,
    },
    null,
    2,
  ),
);
if (!report.passed) process.exitCode = 1;
