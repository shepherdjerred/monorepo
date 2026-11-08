// Verify selected scene rebinding against the fixed original world-schema proof.
import { resolve } from "node:path";
import { loadLatestStaticCatalogSelection } from "../latest-static-catalog.mjs";
import { createLatestWorldStateReader } from "../latest-world-state.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: bun inspect-selected-world-state.mjs <cache>");
const cache = resolve(cacheArg),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    digest = await sha256(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error("Selected world-schema input changed: " + path);
  inputs[path] = digest;
  return bytes;
}
const load = (path) => raw(`${cache}/public/${path}`),
  parse = (bytes) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
await captureDirectSourceInputs([import.meta.path], raw);
const selection = await loadLatestStaticCatalogSelection({ load }),
  profile = selection.profile(),
  image = await load("decoder-16.21-macos/image.bin"),
  sceneBytes = await selection.readRole("scene"),
  scene = parse(sceneBytes),
  packageBytes = await selection.readRole("worldState"),
  catalogBytes = await selection.read(`latest-scene/${scene.world}`);
if ((await sha256(image)) !== profile.decoderImageSha256)
  throw Error("Exact original world-schema decoder image required");
const reader = await createLatestWorldStateReader(
  profile,
  image,
  packageBytes,
  sceneBytes,
  catalogBytes,
  selection,
);
const metadata = parse(packageBytes);
if (
  typeof reader.bind !== "function" ||
  typeof reader.worldState !== "function"
)
  throw Error("Selected native world-schema reader contract differs");
for (const [path, expected] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== expected)
    throw Error(
      "Selected world-schema input changed before publication: " + path,
    );
const result = {
  schema: 1,
  kind: "selected-original-world-schema-contract-control",
  inputs,
  catalog: selection.describe(),
  packageSha256: await sha256(packageBytes),
  mapId: metadata.mapId,
  classes: Object.keys(metadata.classes),
  worldAssets: Object.keys(metadata.assets).length,
  originalInstructionBlocks: metadata.sourceBlocks.length,
  scope: {
    selectedSchemaLoaded: true,
    fixedApprovedSchemaPreservedExceptSceneParent: true,
    originalInstructionHashesChecked: true,
    nativeInstructionsExecutedByThisInspector: false,
    worldEntitiesBound: false,
    effectsRendered: false,
    browserAcceptance: false,
    arbitraryMapSupport: false,
  },
};
const output = `${cache}/research/selected-world-state-control.json`;
await Bun.write(output, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output,
    packageSha256: result.packageSha256,
    classes: result.classes,
    worldAssets: result.worldAssets,
  }),
);
