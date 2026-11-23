// Publish native-observed bytes and their complete scoped proofs; no pixels are
// supplied by this producer and no live resource readiness is asserted.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { describeOriginalColdDefaultProofs } from "../scene-cold-default-textures.mjs";
const [sourceArg, slotArg, remapArg, cacheArg] = process.argv.slice(2);
if (!cacheArg)
  throw Error(
    "Usage: bun prepare-scene-cold-default-textures.mjs <approved-cache> <original-slot-controls.json> <original-shared-remap-proof.json> <archive-cache>",
  );
const slotBytes = await Bun.file(slotArg).bytes(),
  remapBytes = await Bun.file(remapArg).bytes(),
  proofs = [
    JSON.parse(new TextDecoder().decode(slotBytes)),
    JSON.parse(new TextDecoder().decode(remapBytes)),
  ],
  evidence = await describeOriginalColdDefaultProofs(slotBytes, remapBytes),
  inputs = new Map([
    [path.resolve(slotArg), sha(slotBytes)],
    [path.resolve(remapArg), sha(remapBytes)],
  ]),
  sources = {};
for (const proof of proofs) {
  for (const [file, digest] of Object.entries(proof.inputs)) {
    if (sha(await Bun.file(file).bytes()) !== digest)
      throw Error("Original default native input differs");
    inputs.set(path.resolve(file), digest);
  }
  for (const [file, digest] of Object.entries(proof.sources)) {
    if (
      file !== path.basename(file) ||
      sha(await Bun.file(new URL(file, import.meta.url)).bytes()) !== digest
    )
      throw Error("Original default native observer source differs: " + file);
    inputs.set(fileURLToPath(new URL(file, import.meta.url)), digest);
  }
}
for (const file of [
  "prepare-scene-cold-default-textures.mjs",
  "../scene-cold-default-textures.mjs",
  "../structural-comparison.mjs",
  "map-scene-output.mjs",
])
  sources[file] = sha(await Bun.file(new URL(file, import.meta.url)).bytes());
const { out } = await createStaticPreparationOutput(sourceArg, cacheArg, {
    prefix: "cold-defaults-",
    directory: "cold-defaults",
  }),
  files = [];
for (const [file, bytes] of [
  ["slot-proof.json", slotBytes],
  ["remap-proof.json", remapBytes],
]) {
  await Bun.write(path.join(out, file), bytes);
  if (sha(await Bun.file(path.join(out, file)).bytes()) !== sha(bytes))
    throw Error("Native default proof output readback differs");
  files.push({ file, bytes: bytes.length, sha256: sha(bytes) });
}
for (const [file, digest] of inputs)
  if (sha(await Bun.file(file).bytes()) !== digest)
    throw Error("Original default native input changed");
for (const [file, digest] of Object.entries(sources))
  if (sha(await Bun.file(new URL(file, import.meta.url)).bytes()) !== digest)
    throw Error("Native default package source changed");
const manifest = {
  schema: evidence.emptyAuthoredColorBindingProved ? 2 : 1,
  kind: "original-cold-material-default-textures",
  build: proofs[0].build,
  protocol: proofs[0].protocol,
  decoderImageSha256: proofs[0].decoderImageSha256,
  files,
  evidence,
  inputs: Object.fromEntries(inputs),
  sources,
};
await Bun.write(path.join(out, "manifest.json"), JSON.stringify(manifest));
console.log(
  JSON.stringify({
    output: out,
    resources: Object.keys(evidence.resources),
    scope: {
      actualEmitterColorDefaultProved: false,
      dynamicRemapRecovered: false,
      actualScenePredicates: false,
      nativeRendererAdmitted: false,
    },
  }),
);
