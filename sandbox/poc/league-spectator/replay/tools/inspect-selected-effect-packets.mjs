// Original packet/descriptor execution under two scene-parent identities with
// identical native map quantization. This is not world or renderer admission.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256 } from "../structural-comparison.mjs";
import { sameDirectCompiledData } from "../latest-direct-compiled-restore.mjs";
import { loadLatestStaticCatalogSelection } from "../latest-static-catalog.mjs";
import { createLatestEffectDescriptorReader } from "../latest-effect-descriptor.mjs";
import { createLatestEffectPlacementReader } from "../latest-effect-placement.mjs";
import { openReplay, replayChunks, replayBlocks } from "../transport.mjs";
import { StructuralDecoder } from "../structural-decoder.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const [sourceArg, cacheArg, replayArg] = process.argv.slice(2);
if (!sourceArg || !cacheArg || !replayArg || process.argv.length !== 5)
  throw Error(
    "Usage: bun inspect-selected-effect-packets.mjs <approved-source-cache> <selected-cache> <replay.rofl>",
  );
const source = resolve(sourceArg),
  cache = resolve(cacheArg),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    digest = await sha256(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error("Selected packet control input changed: " + path);
  inputs[path] = digest;
  return bytes;
}
const load = (path) => raw(`${cache}/public/${path}`),
  decode = (bytes) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
await captureDirectSourceInputs([import.meta.path], raw);
const selected = await loadLatestStaticCatalogSelection({ load }),
  profile = selected.profile(),
  image = await load("decoder-16.21-macos/image.bin"),
  constructors = await load("decoder-16.21-macos/constructors.bin"),
  sceneBytes = await selected.readRole("scene"),
  creationBytes = await load("latest-effect-creation/package.json"),
  placementBytes = await selected.readRole("effectPlacement"),
  descriptorBytes = await selected.readRole("effectDescriptor"),
  referencePlacement = await selected.readRole("effectPlacementReference"),
  referenceDescriptor = await selected.readRole("effectDescriptorReference"),
  referenceScene = await raw(`${source}/public/latest-scene/manifest.json`);
if (
  (await sha256(image)) !== profile.decoderImageSha256 ||
  (await sha256(constructors)) !== profile.constructorImageSha256 ||
  decode(referenceDescriptor).sceneManifestSha256 !==
    (await sha256(referenceScene)) ||
  decode(referencePlacement).sceneManifestSha256 !==
    (await sha256(referenceScene))
)
  throw Error("Exact original packet image/reference scene required");
let rejection = null;
try {
  await createLatestEffectPlacementReader(
    profile,
    image,
    creationBytes,
    referencePlacement,
    sceneBytes,
  );
} catch (error) {
  rejection = error.message;
}
if (rejection !== "Unsupported effect-placement/map contract")
  throw Error(
    "Actual legacy scene-parent rejection not established: " + rejection,
  );
const runtimePath = `${cache}/public/vendor/unicorn_x86_candidate.mjs`,
  runtimeBytes = await raw(runtimePath),
  runtimeManifest = decode(await raw(runtimePath.replace(/\.mjs$/, ".json")));
if ((await sha256(runtimeBytes)) !== runtimeManifest.sha256)
  throw Error("Pinned packet execution runtime required");
const compressionPath = `${cache}/public/vendor/fzstd.mjs`;
await raw(compressionPath);
const { default: createUnicorn } = await import(
    pathToFileURL(runtimePath).href
  ),
  { decompress } = await import(pathToFileURL(compressionPath).href),
  uc = await createUnicorn();
const baseline = await createLatestEffectDescriptorReader({
  uc,
  profile,
  image,
  creationBytes,
  placementBytes: referencePlacement,
  descriptorBytes: referenceDescriptor,
  sceneBytes: referenceScene,
});
let candidate, decoder;
const controls = [];
try {
  candidate = await createLatestEffectDescriptorReader({
    uc,
    profile,
    image,
    creationBytes,
    placementBytes,
    descriptorBytes,
    sceneBytes,
    staticCatalog: selected,
  });
  decoder = new StructuralDecoder(uc, profile, image, constructors);
  const replayBytes = await raw(replayArg),
    replay = openReplay(
      replayBytes.buffer.slice(
        replayBytes.byteOffset,
        replayBytes.byteOffset + replayBytes.byteLength,
      ),
    );
  if (
    replay.build !== profile.clientVersion ||
    replay.protocol !== profile.protocolDigest
  )
    throw Error("Exact-build packet comparison replay required");
  outer: for (const chunk of replayChunks(replay, decompress, {
    streams: [1, 2],
  })) {
    for (const block of replayBlocks(chunk)) {
      if (block.opcode !== 756 || block.time > 99) continue;
      const observation = decoder.observePacket(
        block.opcode,
        block.payload,
        block.param,
      );
      if (!observation.complete)
        throw Error("Original creation decoder did not consume packet");
      const expected = baseline.read(observation),
        actual = candidate.read(observation);
      if (!sameDirectCompiledData(expected, actual))
        throw Error("Selected native descriptor bytes/coordinates differ");
      controls.push({
        stream: chunk.stream,
        chunkId: chunk.chunkId,
        blockOffset: block.blockOffset,
        time: block.time,
        payloadSha256: await sha256(block.payload),
        records: actual.length,
        descriptorBytes: actual.reduce(
          (sum, row) => sum + row.descriptorBytes.length,
          0,
        ),
      });
      if (controls.length === 3) break outer;
    }
  }
  if (
    controls.length !== 3 ||
    controls.reduce((sum, row) => sum + row.records, 0) === 0
  )
    throw Error(
      "Nonvacuous three-packet original descriptor controls required",
    );
} finally {
  decoder?.close();
  candidate?.close();
  baseline.close();
}
for (const [path, expected] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== expected)
    throw Error("Selected packet source changed before publication: " + path);
const output = `${cache}/research/selected-effect-packets-control.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "selected-original-effect-packet-scene-parent-control",
      inputs,
      selection: selected.describe(),
      legacySecondarySceneRejection: rejection,
      controls,
      scope: {
        originalPacketDecoderExecuted: true,
        originalDescriptorPrefixExecuted: true,
        signedNumericAndDescriptorBytesCompared: true,
        sceneParentOnlyChanged: true,
        liveEntityPointersSuppliedZero: true,
        worldFactoryExecuted: false,
        renderingEstablished: false,
        nativeMatchAcceptance: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    controls,
    fingerprints: Object.keys(inputs).length,
  }),
);
