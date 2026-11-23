import path from "node:path";
import { mkdir } from "node:fs/promises";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { actorObjectHash } from "./archived-actor-bin.mjs";
import { readExactMapBin } from "./exact-map-bin.mjs";
import { sceneAnimationFilePath } from "../scene-animation-authority.mjs";
import { stringifyAssetJson } from "./asset-json.mjs";

const [sourceArg, sceneArg, effectsArg, inventoryArg, cacheArg] =
  process.argv.slice(2);
if (!cacheArg)
  throw Error(
    "Usage: bun prepare-scene-effect-resource-inputs.mjs <approved-source-cache> <closed-common-scene> <matching-effects> <fx-source-inventory> <archive-cache>",
  );
const { out } = await createStaticPreparationOutput(sourceArg, cacheArg, {
    prefix: "effect-resource-inputs-",
    directory: "effect-resource-inputs",
  }),
  roots = {
    scene: path.resolve(sceneArg),
    effects: path.resolve(effectsArg),
    inventory: path.resolve(inventoryArg),
  },
  bytes = {},
  metadata = {},
  selected = {},
  consumed = new Map(),
  written = new Map(),
  compilerSources = {};
const json = (value) => new TextEncoder().encode(stringifyAssetJson(value)),
  decode = (value) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(value));
for (const authority of Object.keys(roots)) {
  bytes[authority] = await Bun.file(
    path.join(roots[authority], "manifest.json"),
  ).bytes();
  metadata[authority] = decode(bytes[authority]);
  selected[authority] = new Map();
  for (const entry of metadata[authority].files) {
    const file = entry.path ?? entry.file;
    sceneAnimationFilePath(file);
    if (selected[authority].has(file))
      throw Error("Duplicate effect resource source input");
    selected[authority].set(file, entry);
  }
}
if (
  metadata.scene.kind !== "archived-map11-common-runtime-scene" ||
  metadata.scene.map?.id !== 11 ||
  metadata.effects.kind !== "archived-map11-partial-effects" ||
  metadata.inventory.kind !== "archived-map11-fx-source-inventory" ||
  metadata.effects.sceneManifestSha256 !== sha(bytes.scene) ||
  metadata.inventory.sceneManifestSha256 !== sha(bytes.scene) ||
  metadata.effects.sourceInventorySha256 !== sha(bytes.inventory)
)
  throw Error("Exact matching archived scene/effects/inventory required");
async function read(authority, file) {
  sceneAnimationFilePath(file);
  const expected = selected[authority].get(file);
  if (!expected) throw Error("Unselected original effect resource input");
  const data = await Bun.file(path.join(roots[authority], file)).bytes();
  if (data.length !== expected.bytes || sha(data) !== expected.sha256)
    throw Error(`Original effect resource input changed: ${authority}:${file}`);
  consumed.set(`${authority}:${file}`, {
    authority,
    file,
    bytes: data.length,
    sha256: sha(data),
  });
  return data;
}
async function write(file, data) {
  sceneAnimationFilePath(file);
  if (written.has(file)) {
    if (written.get(file).sha256 !== sha(data))
      throw Error("Conflicting native resource input");
    return;
  }
  await mkdir(path.dirname(path.join(out, file)), { recursive: true });
  await Bun.write(path.join(out, file), data);
  written.set(file, { file, bytes: data.length, sha256: sha(data) });
}
for (const file of [
  "prepare-scene-effect-resource-inputs.mjs",
  "exact-map-bin.mjs",
  "archived-actor-bin.mjs",
  "archived-actor-sources.mjs",
  "map-scene-output.mjs",
  "map-scene-assets.mjs",
  "asset-json.mjs",
  "../scene-animation-authority.mjs",
])
  compilerSources[file] = sha(
    await Bun.file(new URL(file, import.meta.url)).bytes(),
  );
const inventory = decode(await read("inventory", metadata.inventory.inventory)),
  world = decode(await read("scene", metadata.scene.world)),
  appearances = new Map([
    ...Object.entries(metadata.scene.champions).map(([key, value]) => [
      `champions/${key}`,
      value,
    ]),
    ...Object.entries(world.assets).map(([key, value]) => [
      `world/${key}`,
      value,
    ]),
  ]),
  binFiles = new Map();
for (const file of selected.inventory.keys())
  if (/^bins\/\d+\.typed\.json$/.test(file)) {
    const typed = decode(await read("inventory", file)),
      rawFile = file.replace(".typed.json", ".bin"),
      raw = await read("inventory", rawFile);
    if (sha(raw) !== typed.sourceSha256)
      throw Error("Original resolver BIN digest differs");
    binFiles.set(typed.sourceSha256, {
      raw,
      tree: readExactMapBin(raw, metadata.scene.build, {
        captureFieldSpans: true,
      }),
    });
  }
const owners = new Map(
    inventory.objects.map((entry) => [
      `${entry.wad.toLowerCase()}:${entry.file.toLowerCase()}`,
      entry.sourceSha256,
    ]),
  ),
  groups = new Map();
if (appearances.size !== Object.keys(metadata.effects.actors).length)
  throw Error("Incomplete native resource appearance inventory");
for (const [actorKey, asset] of appearances) {
  const actor = metadata.effects.actors[actorKey],
    actorSources = inventory.actors.find((entry) => entry.actor === actorKey);
  if (
    !actor ||
    actor.character !== asset.character ||
    actor.skinId !== asset.skinId ||
    !actorSources ||
    actorSources.skinSource !== asset.source.skinSha256
  )
    throw Error("Native resource appearance source differs");
  const sourceRows = asset.source.bins
      .map((entry) => ({
        file: entry.path.toLowerCase(),
        sha256: entry.sha256,
      }))
      .sort((left, right) => left.file.localeCompare(right.file)),
    rows = Object.entries(actor.resources)
      .map(([key, value]) => ({
        key: Number.parseInt(key, 16),
        referenceToken: Number.parseInt(actorObjectHash(value.reference), 16),
      }))
      .sort((left, right) => left.key - right.key);
  const resolverId =
      actor.resourceResolverId === null
        ? null
        : Number.parseInt(actorObjectHash(actor.resourceResolverId), 16),
    candidates = [];
  for (const id of actorSources.bins) {
    const sourceSha256 = owners.get(id.toLowerCase()),
      bin = binFiles.get(sourceSha256);
    if (!bin) continue;
    for (const node of bin.tree.objects)
      if (node.pathHash === resolverId?.toString(16).padStart(8, "0"))
        candidates.push({ id, sourceSha256, bin, node });
  }
  if (
    resolverId !== null &&
    (!candidates.length ||
      new Set(
        candidates.map((entry) =>
          stringifyAssetJson({
            classHash: entry.node.classHash,
            fields: entry.node.fields,
          }),
        ),
      ).size !== 1)
  )
    throw Error(`Original resolver owner is missing or ambiguous: ${actorKey}`);
  const resolver = candidates[0],
    sourceIdentity = {
      character: asset.character,
      skinId: asset.skinId,
      skinSha256: asset.source.skinSha256,
      wad: asset.source.wad.toLowerCase(),
      sourceRows,
      resolverId,
      resolverSourceSha256: resolver?.sourceSha256 ?? null,
      resolverPathHash: resolver?.node.pathHash ?? null,
      resolverClassHash: resolver?.node.classHash ?? null,
      rows,
    };
  if (resolver && resolver.node.classHash !== "ef3a0f33")
    throw Error("Original resolver class differs");
  const groupKey = `${asset.character.toLowerCase()}:${asset.skinId}`,
    old = groups.get(groupKey);
  if (old) {
    if (
      stringifyAssetJson({
        ...old.sourceIdentity,
        character: old.sourceIdentity.character.toLowerCase(),
      }) !==
      stringifyAssetJson({
        ...sourceIdentity,
        character: sourceIdentity.character.toLowerCase(),
      })
    )
      throw Error(`Appearance alias changes original source/rows: ${actorKey}`);
    old.actorAliases.push(actorKey);
    old.aliasSources.push({ actorKey, name: asset.character, sourceIdentity });
    continue;
  }
  const fields = [];
  if (resolver) {
    const rawFile = `bins/${resolver.sourceSha256}.bin`;
    await write(rawFile, resolver.bin.raw);
    for (const span of resolver.node.fieldSpans) {
      const data = resolver.bin.raw.subarray(
          span.offset,
          span.offset + span.bytes,
        ),
        file = `fields/${groups.size}/${fields.length}.bin`;
      await write(file, data);
      fields.push({
        file,
        bytes: data.length,
        sha256: sha(data),
        sourceBin: rawFile,
        sourceBinSha256: resolver.sourceSha256,
        start: span.offset,
        end: span.offset + span.bytes,
        fieldHash: span.fieldHash,
      });
    }
  }
  groups.set(groupKey, {
    actorKey,
    actorAliases: [actorKey],
    aliasSources: [{ actorKey, name: asset.character, sourceIdentity }],
    name: asset.character,
    skinId: asset.skinId,
    namespace: "characters",
    sourceIdentity,
    resolverFields: fields,
  });
}
const request = {
  schema: 2,
  kind: "original-scene-effect-resource-inputs",
  aliasIdentityPolicy:
    "original-ascii-case-insensitive-namespace-with-complete-per-alias-source-witness",
  build: metadata.scene.build,
  protocol: metadata.scene.protocol,
  sceneManifestSha256: sha(bytes.scene),
  effectsManifestSha256: sha(bytes.effects),
  sourceInventorySha256: sha(bytes.inventory),
  contexts: [...groups.values()],
  appearances: appearances.size,
  compilerSources,
  consumedInputs: [...consumed.values()],
  nativeSpectatorAdmitted: false,
};
await write("input.json", json(request));
for (const entry of consumed.values()) await read(entry.authority, entry.file);
for (const [authority, root] of Object.entries(roots))
  if (
    sha(await Bun.file(path.join(root, "manifest.json")).bytes()) !==
    sha(bytes[authority])
  )
    throw Error("Native resource authority changed");
for (const [file, digest] of Object.entries(compilerSources))
  if (sha(await Bun.file(new URL(file, import.meta.url)).bytes()) !== digest)
    throw Error("Native resource input producer changed");
await Bun.write(
  path.join(out, "manifest.json"),
  json({ ...request, input: "input.json", files: [...written.values()] }),
);
console.log(
  JSON.stringify({
    output: out,
    appearances: appearances.size,
    canonicalContexts: groups.size,
    aliases: appearances.size - groups.size,
    nativeSpectatorAdmitted: false,
  }),
);
