import path from "node:path";
import { sha256 } from "../structural-comparison.mjs";

const [decoderRoot, nativePath, inputPath, output] = process.argv.slice(2);
if (!output)
  throw Error(
    "Usage: bun prepare-native-hud-authored-uv.mjs <decoder-directory> <native-uv-controls.json> <authored-inputs.json> <output.json>",
  );
const image = await Bun.file(path.join(decoderRoot, "image.bin")).bytes(),
  profileBytes = await Bun.file(path.join(decoderRoot, "profile.json")).bytes(),
  profile = JSON.parse(new TextDecoder().decode(profileBytes)),
  spawnBytes = await Bun.file(path.join(decoderRoot, "vfx-spawn.json")).bytes(),
  nativeBytes = await Bun.file(nativePath).bytes(),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  inputBytes = await Bun.file(inputPath).bytes();
if (
  native.kind !== "original-authored-hud-atlas-uv-controls" ||
  native.inputsSha256 !== (await sha256(inputBytes)) ||
  native.constructorRva !== 0x18ef3a0 ||
  native.uvFunctionRva !== 0x18a1c70 ||
  native.imageSha256 !== profile.decoderImageSha256 ||
  native.imageSha256 !== (await sha256(image)) ||
  profile.vfxSpawnSha256 !== (await sha256(spawnBytes)) ||
  !native.observations.length ||
  native.observations.some(
    (row) => row.boundary !== null || row.cases.length !== 4,
  )
)
  throw Error("Original authored HUD UV proof lineage changed");
for (const [source, expected] of Object.entries(native.sources))
  if ((await sha256(await Bun.file(source).bytes())) !== expected)
    throw Error(`Stale original HUD UV producer: ${source}`);
for (const block of native.originalBlocks)
  if (
    (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
    block.sha256
  )
    throw Error("Original HUD UV source block changed");
const manifest = {
  schema: 1,
  kind: "native-hud-authored-atlas-uv",
  build: profile.clientVersion,
  protocol: profile.protocolDigest,
  imageSha256: profile.decoderImageSha256,
  sliceSha256: profile.sliceSha256,
  vfxSpawnSha256: profile.vfxSpawnSha256,
  runtimeSha256:
    "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716",
  constructorRva: native.constructorRva,
  uvFunctionRva: native.uvFunctionRva,
  vtableRva: 0x2404d18,
  sourceBlocks: native.originalBlocks,
  nativeObservation: {
    sha256: await sha256(nativeBytes),
    inputSha256: await sha256(inputBytes),
    providers: native.observations.length,
    controls: native.observations.reduce(
      (count, row) => count + row.cases.length,
      0,
    ),
  },
  scope: {
    originalAuthoredUvExecution: true,
    explicitFlipControlBits: true,
    runtimeFlagBindings: false,
    imageAtlasComposition: false,
    slicedProviders: false,
    renderedHud: false,
  },
};
await Bun.write(output, JSON.stringify(manifest, null, 2));
console.log(
  JSON.stringify({
    output,
    sha256: await sha256(await Bun.file(output).bytes()),
    sourceBlocks: manifest.sourceBlocks.length,
    scope: manifest.scope,
  }),
);
