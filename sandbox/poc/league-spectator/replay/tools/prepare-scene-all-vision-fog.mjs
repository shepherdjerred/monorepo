// Publish the scoped original all-vision callback/resource proof without
// modifying its native receipts, approved image or the prepared scene.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import {
  describeOriginalAllVisionFogProofs,
  createSceneAllVisionFog,
} from "../scene-all-vision-fog.mjs";
const [sourceArg, sceneArg, resourceArg, extentArg, cacheArg] =
  process.argv.slice(2);
if (!cacheArg)
  throw Error(
    "Usage: bun prepare-scene-all-vision-fog.mjs <approved-cache> <scene-root> <resource-native-proof.json> <extent-native-proof.json> <archive-cache>",
  );
const inputs = new Map(),
  sources = {};
async function read(file) {
  const bytes = await Bun.file(file).bytes();
  inputs.set(path.resolve(file), sha(bytes));
  return bytes;
}
const resourceBytes = await read(resourceArg),
  extentBytes = await read(extentArg),
  resource = JSON.parse(new TextDecoder().decode(resourceBytes)),
  extent = JSON.parse(new TextDecoder().decode(extentBytes));
const evidence = await describeOriginalAllVisionFogProofs(
  resourceBytes,
  extentBytes,
);
for (const proof of [resource, extent]) {
  for (const [file, digest] of Object.entries({
    ...proof.inputs,
    ...proof.fowResourceExtensionInputs,
  }))
    if (sha(await read(file)) !== digest)
      throw Error("All-vision native proof input changed: " + file);
  for (const [file, digest] of Object.entries(proof.sources ?? {})) {
    if (
      file !== path.basename(file) ||
      sha(await read(fileURLToPath(new URL(file, import.meta.url)))) !== digest
    )
      throw Error("All-vision native observer changed: " + file);
  }
}
for (const file of [
  "prepare-scene-all-vision-fog.mjs",
  "map-scene-output.mjs",
  "archived-actor-sources.mjs",
  "../scene-all-vision-fog.mjs",
  "../scene-cold-default-textures.mjs",
  "../structural-comparison.mjs",
  "../latest-direct-compiled-restore.mjs",
])
  sources[file] = sha(
    await read(fileURLToPath(new URL(file, import.meta.url))),
  );
const sceneBytes = await read(path.join(sceneArg, "manifest.json")),
  worldBytes = await read(path.join(sceneArg, "world.json")),
  baseProfileBytes = await read(
    path.join(sourceArg, "public/decoder-16.21-macos/profile.json"),
  ),
  imageBytes = await read(
    path.join(sourceArg, "public/decoder-16.21-macos/image.bin"),
  );
const files = [
  ["resource-proof.json", resourceBytes],
  ["extent-proof.json", extentBytes],
].map(([file, bytes]) => ({ file, bytes: bytes.length, sha256: sha(bytes) }));
const manifest = {
  schema: 1,
  kind: "original-scene-all-vision-fog",
  build: resource.build,
  protocol: resource.protocol,
  perspective: "all",
  decoderImageSha256: sha(imageBytes),
  baseProfileSha256: sha(baseProfileBytes),
  sceneManifestSha256: sha(sceneBytes),
  worldSha256: sha(worldBytes),
  files,
  evidence,
  sources,
  inputs: Object.fromEntries(inputs),
};
await createSceneAllVisionFog({
  manifestBytes: new TextEncoder().encode(JSON.stringify(manifest)),
  readResource: async (file) =>
    file === "resource-proof.json" ? resourceBytes : extentBytes,
  sceneBytes,
  worldBytes,
  baseProfileBytes,
  imageBytes,
  perspective: "all",
});
const { out } = await createStaticPreparationOutput(sourceArg, cacheArg, {
  prefix: "scene-all-vision-fog-",
  directory: "scene-all-vision-fog",
});
for (const [file, bytes] of [
  ["resource-proof.json", resourceBytes],
  ["extent-proof.json", extentBytes],
]) {
  await Bun.write(path.join(out, file), bytes);
  if (sha(await Bun.file(path.join(out, file)).bytes()) !== sha(bytes))
    throw Error("All-vision proof output readback differs");
}
for (const [file, digest] of inputs)
  if (sha(await Bun.file(file).bytes()) !== digest)
    throw Error("All-vision authority input changed: " + file);
await Bun.write(path.join(out, "manifest.json"), JSON.stringify(manifest));
console.log(
  JSON.stringify({
    output: out,
    authoritySha256: sha(
      await Bun.file(path.join(out, "manifest.json")).bytes(),
    ),
    perspective: "all",
    nativeSpectatorAdmitted: false,
  }),
);
