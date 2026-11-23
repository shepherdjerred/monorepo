// Full static source data behind the lazy FX index. This does not approve native
// postload, materials, activation or factory resource precedence.
import path from "node:path";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { actorObjectHash } from "./archived-actor-bin.mjs";
import { stringifyAssetJson } from "./asset-json.mjs";
import { sceneAnimationFilePath } from "../scene-animation-authority.mjs";

const [sourceArg, effectsArg, inventoryArg, cacheArg] = process.argv.slice(2);
if (!cacheArg)
  throw Error(
    "Usage: bun prepare-scene-effects-source.mjs <approved-source-cache> <closed-effects-package> <closed-fx-source-inventory> <archive-cache>",
  );
const { out } = await createStaticPreparationOutput(sourceArg, cacheArg, {
    prefix: "effects-source-",
    directory: "effects-source",
  }),
  effectsRoot = path.resolve(effectsArg),
  inventoryRoot = path.resolve(inventoryArg),
  effectsBytes = await Bun.file(
    path.join(effectsRoot, "manifest.json"),
  ).bytes(),
  effects = JSON.parse(new TextDecoder().decode(effectsBytes)),
  inventoryBytes = await Bun.file(
    path.join(inventoryRoot, "manifest.json"),
  ).bytes(),
  inventoryManifest = JSON.parse(new TextDecoder().decode(inventoryBytes)),
  selectedEffects = new Map(effects.files.map((entry) => [entry.path, entry])),
  selectedInventory = new Map(
    inventoryManifest.files.map((entry) => [entry.file, entry]),
  ),
  consumed = [];
if (
  effects.kind !== "archived-map11-partial-effects" ||
  inventoryManifest.kind !== "archived-map11-fx-source-inventory" ||
  effects.sourceInventorySha256 !== sha(inventoryBytes) ||
  effects.sceneManifestSha256 !== inventoryManifest.sceneManifestSha256
)
  throw Error("Matching original FX inventory/package required");
async function read(root, selected, file, authority, capture = true) {
  sceneAnimationFilePath(file);
  const expected = selected.get(file);
  if (!expected) throw Error("Unselected effect source input");
  const bytes = await Bun.file(path.join(root, file)).bytes();
  if (bytes.length !== expected.bytes || sha(bytes) !== expected.sha256)
    throw Error("Original effect source input changed");
  if (capture)
    consumed.push({ authority, file, bytes: bytes.length, sha256: sha(bytes) });
  return bytes;
}
const compilerFiles = [
    "prepare-scene-effects-source.mjs",
    "archived-actor-sources.mjs",
    "archived-actor-bin.mjs",
    "map-scene-output.mjs",
    "asset-json.mjs",
    "../scene-animation-authority.mjs",
  ],
  compilerSources = {};
for (const file of compilerFiles)
  compilerSources[file] = sha(
    await Bun.file(new URL(file, import.meta.url)).bytes(),
  );
const inventory = JSON.parse(
    new TextDecoder().decode(
      await read(
        inventoryRoot,
        selectedInventory,
        inventoryManifest.inventory,
        "inventory",
      ),
    ),
  ),
  owners = new Map(
    inventory.objects.map((entry) => [
      `${entry.wad.toLowerCase()}:${entry.file.toLowerCase()}`,
      entry.sourceSha256,
    ]),
  ),
  actors = {},
  definitions = {},
  linkedDefinitions = {};
for (const row of inventory.actors) {
  const actor = effects.actors[row.actor];
  if (
    !actor ||
    actor.character !== row.character ||
    actor.skinId !== row.skinId
  )
    throw Error("Original effect source appearance differs");
  actors[row.actor] = {
    ...actor,
    sourceBins: row.bins.flatMap((id) => {
      const digest = owners.get(id.toLowerCase());
      if (!digest) return [];
      const separator = id.indexOf(":");
      return [
        {
          path: id.slice(separator + 1),
          archive: id.slice(0, separator),
          sourceSha256: digest,
        },
      ];
    }),
  };
}
for (const [id, index] of Object.entries(effects.definitions)) {
  const bytes = await read(effectsRoot, selectedEffects, index.file, "effects"),
    value = JSON.parse(new TextDecoder().decode(bytes));
  if (
    sha(bytes) !== index.sha256 ||
    value.actor !== index.actor ||
    value.definition.__type !== index.class
  )
    throw Error("Original lazy effect definition index differs");
  (actorObjectHash(index.class) === actorObjectHash("VfxSystemDefinitionData")
    ? definitions
    : linkedDefinitions)[id] = value;
}
const result = {
    schema: 1,
    kind: "archived-map11-partial-effects-source",
    build: effects.build,
    protocol: effects.protocol,
    sceneManifestSha256: effects.sceneManifestSha256,
    effectsManifestSha256: sha(effectsBytes),
    sourceInventorySha256: sha(inventoryBytes),
    actors,
    effects: definitions,
    linkedDefinitions,
    assets: effects.assets,
    sourceAssets: inventoryManifest.provenance,
    summary: effects.summary,
    compilerSources,
    consumedInputs: consumed,
    limitations: effects.limitations,
    nativeSpectatorAdmitted: false,
  },
  encoded = new TextEncoder().encode(stringifyAssetJson(result));
await Bun.write(path.join(out, "package.json"), encoded);
for (const entry of consumed)
  await read(
    entry.authority === "effects" ? effectsRoot : inventoryRoot,
    entry.authority === "effects" ? selectedEffects : selectedInventory,
    entry.file,
    entry.authority,
    false,
  );
if (
  sha(await Bun.file(path.join(effectsRoot, "manifest.json")).bytes()) !==
    sha(effectsBytes) ||
  sha(await Bun.file(path.join(inventoryRoot, "manifest.json")).bytes()) !==
    sha(inventoryBytes)
)
  throw Error("Original effect source authority changed");
for (const [file, digest] of Object.entries(compilerSources))
  if (sha(await Bun.file(new URL(file, import.meta.url)).bytes()) !== digest)
    throw Error("Effect source producer changed");
await Bun.write(
  path.join(out, "manifest.json"),
  JSON.stringify(
    {
      schema: 1,
      kind: "archived-map11-effects-source-authority",
      build: effects.build,
      protocol: effects.protocol,
      sceneManifestSha256: effects.sceneManifestSha256,
      effectsManifestSha256: sha(effectsBytes),
      files: [
        { file: "package.json", bytes: encoded.length, sha256: sha(encoded) },
      ],
      nativeSpectatorAdmitted: false,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output: out,
    packageSha256: sha(encoded),
    actors: Object.keys(actors).length,
    definitions: Object.keys(definitions).length,
    nativeSpectatorAdmitted: false,
  }),
);
