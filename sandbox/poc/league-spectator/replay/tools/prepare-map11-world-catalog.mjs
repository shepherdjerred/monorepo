// Close original static world data, recorded bindings and native scene controls.
import path from "node:path";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import { readExactMapBin } from "./exact-map-bin.mjs";
import {
  readMap11PlaceableInventory,
  bindMap11BarracksDefinitions,
  selectMap11RecordedRegistry,
} from "./map11-world-catalog.mjs";
const [
  worldArg,
  sceneArg,
  sourceArg,
  cacheArg,
  reportArg,
  variantArg,
  navigationArg,
] = process.argv.slice(2);
if (!navigationArg)
  throw Error(
    "Usage: bun prepare-map11-world-catalog.mjs <world-source-dir> <map-scene-dir> <approved-source-cache> <archive-cache> <decoded-report> <native-variant-proof> <native-navgrid-proof>",
  );
const inputs = {},
  sha = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
async function raw(file) {
  const bytes = await Bun.file(file).bytes();
  const key = path.resolve(file),
    digest = sha(bytes);
  if (inputs[key] !== undefined && inputs[key] !== digest)
    throw Error(`World catalog input changed during preparation ${file}`);
  inputs[key] = digest;
  return bytes;
}
const json = async (file) =>
  JSON.parse(new TextDecoder().decode(await raw(file)));
const sourceManifest = await json(
  path.join(worldArg, "world-source-manifest.json"),
);
if (
  sourceManifest.kind !== "archived-map11-world-source" ||
  sourceManifest.build !== "16.21.829.8620" ||
  sourceManifest.protocol !== "20e09df23c66b85e" ||
  sourceManifest.releaseManifestId !== "B499FB04B1158CF6"
)
  throw Error("Exact archived world source required");
for (const file of sourceManifest.files) {
  if (
    file.path.includes("\\") ||
    file.path
      .split("/")
      .some((part) => !part || part === "." || part === "..") ||
    path.isAbsolute(file.path)
  )
    throw Error("Bounded source inventory path required");
  const bytes = await raw(path.join(worldArg, file.path));
  if (bytes.length !== file.bytes || sha(bytes) !== file.sha256)
    throw Error(`Original world source inventory changed ${file.path}`);
}
const materialBytes = await raw(path.join(worldArg, "materials.bin"));
const definitionBytes = await raw(path.join(worldArg, "map-definition.bin"));
const materialTree = readExactMapBin(materialBytes),
  definitions = readExactMapBin(definitionBytes);
const sceneBytes = await raw(path.join(sceneArg, "manifest.json")),
  scene = JSON.parse(new TextDecoder().decode(sceneBytes));
const report = await json(reportArg),
  variant = await json(variantArg),
  navigation = await json(navigationArg);
const profile = await json(
  path.join(sourceArg, "public/decoder-16.21-macos/profile.json"),
);
const image = await raw(
  path.join(sourceArg, "public/decoder-16.21-macos/image.bin"),
);
if (
  scene.build !== sourceManifest.build ||
  scene.protocol !== sourceManifest.protocol ||
  scene.map.id !== 11 ||
  sha(image) !== profile.decoderImageSha256
)
  throw Error("Exact Map11 scene/image required");
for (const proof of [variant, navigation]) {
  if (
    proof.boundary !== null ||
    proof.build !== scene.build ||
    proof.protocol !== scene.protocol ||
    proof.decoderImageSha256 !== profile.decoderImageSha256
  )
    throw Error("Completed original Map11 native control required");
  for (const block of proof.originalBlocks)
    if (sha(image.subarray(block.rva, block.rva + block.size)) !== block.sha256)
      throw Error("Original native scene instructions changed");
  for (const [file, digest] of Object.entries(proof.sources))
    if (sha(await raw(file)) !== digest)
      throw Error(`Native scene control source changed ${file}`);
}
if (
  variant.sourceBinSha256 !== definitions.sourceSha256 ||
  !variant.scope.originalMapSkinConstructorCompleted ||
  variant.context.variant !== report.startup.recordedMapSkin ||
  variant.context.paths.mMapContainerLink.value.toLowerCase() + ".mapgeo" !==
    scene.map.geometryPath.replace(/^data\//, "") ||
  !variant.context.navigationSelection.componentTakesPrecedence ||
  variant.context.navigationSelection.authoredComponentReturnsPath !==
    scene.map.navPath ||
  navigation.sceneManifestSha256 !== sha(sceneBytes) ||
  navigation.navgridSha256 !== scene.map.heightGrid.sourceSha256 ||
  !navigation.scope.completeOriginalNavgridLoad ||
  !navigation.result.heightsMatch ||
  !navigation.result.originalReadyPredicateAfterLoad ||
  !navigation.result.managerGuardIntact
)
  throw Error(
    "Recorded variant, authored geometry and original navigation controls do not agree",
  );
const containerHash = scene.map.containerName.slice(1, -1);
const inventory = bindMap11BarracksDefinitions(
  readMap11PlaceableInventory(materialTree, containerHash),
  definitions,
);
const binding = selectMap11RecordedRegistry(report, inventory);
const request = {
  schema: 1,
  build: scene.build,
  protocol: scene.protocol,
  actors: inventory.assetRequests.map((actor) => ({
    character: actor.character,
    skinId: actor.skinId,
    role: "world",
    characterRecords: actor.records,
  })),
  provenance: {
    materialsSha256: materialTree.sourceSha256,
    mapDefinitionSha256: definitions.sourceSha256,
    replaySha256: report.replaySha256,
    scope:
      "Original authored actor requests only; entity existence comes from decoded events",
  },
};
const { out } = await createStaticPreparationOutput(sourceArg, cacheArg, {
  prefix: "catalog-",
  directory: "latest-scene",
});
const write = (name, value) =>
  Bun.write(path.join(out, name), JSON.stringify(value, null, 2));
await write("placeables.json", inventory);
await write("recorded-binding.json", binding);
await write("actor-request.json", request);
await write("scene-contract.json", {
  schema: 1,
  build: scene.build,
  protocol: scene.protocol,
  map: scene.map,
  recordedMapSkin: report.startup.recordedMapSkin,
  geometryManifestSha256: sha(sceneBytes),
  nativeVariantProofSha256: inputs[path.resolve(variantArg)],
  nativeNavigationProofSha256: inputs[path.resolve(navigationArg)],
  fullMapProviderBootstrapExecuted: false,
  spectatorAdmission: false,
});
const files = [];
for (const file of new Bun.Glob("**/*").scanSync({
  cwd: out,
  onlyFiles: true,
})) {
  const bytes = await Bun.file(path.join(out, file)).bytes();
  files.push({
    path: file.replaceAll("\\", "/"),
    sha256: sha(bytes),
    bytes: bytes.length,
  });
}
for (const [file, digest] of Object.entries(inputs))
  if (sha(await Bun.file(file).bytes()) !== digest)
    throw Error(`World catalog input changed before publication ${file}`);
await write("catalog-manifest.json", {
  schema: 1,
  kind: "recorded-map11-world-catalog",
  build: scene.build,
  protocol: scene.protocol,
  spectatorAdmission: false,
  inputs,
  files,
  sources: Object.fromEntries(
    await Promise.all(
      [
        "prepare-map11-world-catalog.mjs",
        "map11-world-catalog.mjs",
        "exact-map-bin.mjs",
        "map-scene-output.mjs",
      ].map(async (name) => [
        name,
        sha(await Bun.file(new URL(name, import.meta.url)).bytes()),
      ]),
    ),
  ),
  limitations: [
    "Recorded anchors constrain one authored registration chunk; native full initializer remains separate",
    "World/corpse replication policies and actor GPU resources must be independently prepared before runtime admission",
  ],
});
console.log(
  JSON.stringify({
    output: out,
    anchors: binding.anchors,
    minions: binding.minions.length,
    registration: binding.registration.length,
    actors: request.actors.length,
    spectatorAdmission: false,
  }),
);
