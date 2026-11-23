import path from "node:path";
import { sha256 } from "../structural-comparison.mjs";

const [decoderPath, nativePath, anchorPath, output] = process.argv.slice(2);
if (!output)
  throw Error(
    "Usage: bun prepare-native-hud-layout.mjs <decoder-directory> <native-layout-control.json> <native-anchor-observations.json> <output.json>",
  );
const profileBytes = await Bun.file(
    path.join(decoderPath, "profile.json"),
  ).bytes(),
  profile = JSON.parse(new TextDecoder().decode(profileBytes)),
  spawnBytes = await Bun.file(path.join(decoderPath, "vfx-spawn.json")).bytes(),
  image = await Bun.file(path.join(decoderPath, "image.bin")).bytes(),
  nativeBytes = await Bun.file(nativePath).bytes(),
  native = JSON.parse(new TextDecoder().decode(nativeBytes)),
  anchorBytes = await Bun.file(anchorPath).bytes(),
  anchors = JSON.parse(new TextDecoder().decode(anchorBytes));
if (
  native.kind !== "original-authored-hud-root-parent-layout-control" ||
  native.observations.length !== 403 ||
  (await sha256(image)) !== native.imageSha256 ||
  native.imageSha256 !== profile.decoderImageSha256 ||
  anchors.imageSha256 !== native.imageSha256 ||
  (await sha256(anchorBytes)) !== native.anchorsSha256 ||
  (await sha256(spawnBytes)) !== profile.vfxSpawnSha256 ||
  native.originalMathInitialization.startRva !== 0x14aa3bf ||
  native.originalMathInitialization.endRva !== 0x14aa5f9
)
  throw Error("Original HUD layout observation lineage changed");
for (const [source, expected] of [
  ["observe-native-hud-layouts.py", native.sourceSha256],
  ["ui_manager_native.py", native.nativeHelperSha256],
  ["observe-native-hud-anchors.py", anchors.sourceSha256],
])
  if (
    (await sha256(
      await Bun.file(path.join(import.meta.dir, source)).bytes(),
    )) !== expected
  )
    throw Error(`Stale native HUD observation producer: ${source}`);
for (const block of native.originalBlocks)
  if (
    (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
    block.sha256
  )
    throw Error("Original HUD observed code changed");
const manifest = {
  schema: 1,
  kind: "native-hud-root-layout",
  build: profile.clientVersion,
  protocol: profile.protocolDigest,
  imageSha256: profile.decoderImageSha256,
  sliceSha256: profile.sliceSha256,
  runtimeSha256:
    "d87dd63eebd4ac8594c3388cfe25004c87f29216ad4a9bd28487852255e59716",
  vfxSpawnSha256: profile.vfxSpawnSha256,
  profileSha256: await sha256(profileBytes),
  layoutRva: native.layoutRva,
  positionConstructorRva: 0x18fa610,
  anchorConstructors: Object.fromEntries(
    anchors.observations.map((item) => [item.nameHint, item.constructorRva]),
  ),
  sourceBlocks: native.originalBlocks,
  nativeObservation: {
    sha256: await sha256(nativeBytes),
    anchorsSha256: await sha256(anchorBytes),
    rectangles: native.observations.length,
    viewportObservations: native.observations.reduce(
      (sum, item) => sum + item.results.length,
      0,
    ),
  },
  scope: {
    originalLayoutExecution: true,
    authoredPositionInputsPreserved: true,
    rootParent: true,
    defaultSettings: true,
    sceneControllerState: false,
    nativeTextLayout: false,
    renderedHud: false,
  },
};
await Bun.write(output, JSON.stringify(manifest, null, 2));
console.log(
  JSON.stringify({
    output,
    sha256: await sha256(await Bun.file(output).bytes()),
    anchors: manifest.anchorConstructors,
    sourceBlocks: manifest.sourceBlocks.length,
    scope: manifest.scope,
  }),
);
