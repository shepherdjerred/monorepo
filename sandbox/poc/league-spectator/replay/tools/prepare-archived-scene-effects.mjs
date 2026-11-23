// Match-independent archived FX translation. Original activation and native
// renderer admission remain separate from this static resource package.
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import {
  actorObjectHash,
  ACTOR_TOOLKIT_REVISION,
  ACTOR_META_SOURCE_SHA256,
  readActorMetaNames,
  normalizeActorBin,
} from "./archived-actor-bin.mjs";
import { readExactMapBin } from "./exact-map-bin.mjs";
import {
  createArchivedFxObjectIndex,
  compileArchivedFxActor,
  archivedFxField,
} from "./archived-fx-bindings.mjs";
import { identifyArchivedFxFormat } from "./archived-fx-formats.mjs";
import { sceneAnimationFilePath } from "../scene-animation-authority.mjs";
import { stringifyAssetJson } from "./asset-json.mjs";

const [sourceArg, sceneArg, inventoryArg, cacheArg, dotnet = "dotnet"] =
  process.argv.slice(2);
if (!cacheArg)
  throw Error(
    "Usage: bun prepare-archived-scene-effects.mjs <approved-source-cache> <closed-common-scene> <closed-fx-inventory> <archive-cache> [dotnet]",
  );
const { sourceCache, out, work } = await createStaticPreparationOutput(
    sourceArg,
    cacheArg,
    { prefix: "effects-", directory: "latest-effects" },
  ),
  sceneRoot = path.resolve(sceneArg),
  inventoryRoot = path.resolve(inventoryArg),
  sceneBytes = await Bun.file(path.join(sceneRoot, "manifest.json")).bytes(),
  scene = JSON.parse(new TextDecoder().decode(sceneBytes)),
  inventoryBytes = await Bun.file(
    path.join(inventoryRoot, "manifest.json"),
  ).bytes(),
  inventoryManifest = JSON.parse(new TextDecoder().decode(inventoryBytes));
if (
  scene.kind !== "archived-map11-common-runtime-scene" ||
  scene.build !== "16.21.829.8620" ||
  scene.protocol !== "20e09df23c66b85e" ||
  scene.map?.id !== 11 ||
  inventoryManifest.kind !== "archived-map11-fx-source-inventory" ||
  inventoryManifest.build !== scene.build ||
  inventoryManifest.protocol !== scene.protocol ||
  inventoryManifest.sceneManifestSha256 !== sha(sceneBytes) ||
  inventoryManifest.nativeSpectatorAdmitted !== false
)
  throw Error(
    "Matching exact archived Map11 scene and FX source inventory required",
  );
const selectedScene = new Map(scene.files.map((entry) => [entry.path, entry])),
  selectedInventory = new Map(),
  consumed = new Map(),
  written = new Map(),
  compilerSources = {},
  referenceHashes = {};
for (const entry of inventoryManifest.files) {
  sceneAnimationFilePath(entry.file);
  if (selectedInventory.has(entry.file))
    throw Error("Duplicate FX source inventory entry");
  selectedInventory.set(entry.file, entry);
}
if (selectedScene.size !== scene.files.length)
  throw Error("Duplicate selected scene file");
async function read(root, file, entries, namespace) {
  sceneAnimationFilePath(file);
  const expected = entries.get(file);
  if (!expected)
    throw Error(`Unselected FX compiler input: ${namespace}:${file}`);
  const bytes = await Bun.file(path.join(root, file)).bytes();
  if (bytes.length !== expected.bytes || sha(bytes) !== expected.sha256)
    throw Error(`FX compiler input changed: ${namespace}:${file}`);
  consumed.set(`${namespace}:${file}`, {
    authority: namespace,
    file,
    bytes: bytes.length,
    sha256: expected.sha256,
  });
  return bytes;
}
const readScene = (file) => read(sceneRoot, file, selectedScene, "scene"),
  readInventory = (file) =>
    read(inventoryRoot, file, selectedInventory, "inventory"),
  decode = (bytes) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
async function write(file, bytes) {
  sceneAnimationFilePath(file);
  await mkdir(path.dirname(path.join(out, file)), { recursive: true });
  await Bun.write(path.join(out, file), bytes);
  written.set(file, { path: file, bytes: bytes.length, sha256: sha(bytes) });
}
const json = (value) => new TextEncoder().encode(stringifyAssetJson(value));
for (const file of [
  "prepare-archived-scene-effects.mjs",
  "archived-fx-bindings.mjs",
  "archived-fx-formats.mjs",
  "archived-actor-bin.mjs",
  "archived-actor-sources.mjs",
  "exact-map-bin.mjs",
  "map-scene-output.mjs",
  "map-scene-assets.mjs",
  "asset-json.mjs",
  "../scene-animation-authority.mjs",
])
  compilerSources[file] = sha(
    await Bun.file(new URL(file, import.meta.url)).bytes(),
  );
const exporter = path.join(
    sourceCache,
    "exporter-build/bin/Debug/net10.0/Exporter.dll",
  ),
  approvedReceiptFile = path.join(
    sourceCache,
    "public/latest-scene/manifest.json",
  ),
  approvedReceiptBytes = await Bun.file(approvedReceiptFile).bytes(),
  approved = decode(approvedReceiptBytes);
if (
  approved.build !== scene.build ||
  approved.toolchain.leagueToolkitRevision !== ACTOR_TOOLKIT_REVISION ||
  approved.toolchain.exporterSha256 !== sha(await Bun.file(exporter).bytes())
)
  throw Error("Pinned original texture/static-mesh exporter changed");
for (const file of new Bun.Glob("*.dll").scanSync({
  cwd: path.dirname(exporter),
  onlyFiles: true,
}))
  referenceHashes[file] = sha(
    await Bun.file(path.join(path.dirname(exporter), file)).bytes(),
  );
const inventory = decode(await readInventory(inventoryManifest.inventory)),
  world = decode(await readScene(scene.world)),
  actorAssets = new Map([
    ...Object.entries(scene.champions).map(([key, value]) => [
      `champions/${key}`,
      value,
    ]),
    ...Object.entries(world.assets).map(([key, value]) => [
      `world/${key}`,
      value,
    ]),
  ]);
const metadataFile = path.join(
    sourceCache,
    "research/LeagueToolkit/src/LeagueToolkit.Meta.Classes/Classes.cs",
  ),
  metadataBytes = await Bun.file(metadataFile).bytes();
if (sha(metadataBytes) !== ACTOR_META_SOURCE_SHA256)
  throw Error("Original FX metadata annotation source changed");
const names = readActorMetaNames(
  new TextDecoder("utf-8", { fatal: true }).decode(metadataBytes),
);
if (
  actorAssets.size !== inventory.actors.length ||
  inventory.actors.some((entry) => !actorAssets.has(entry.actor))
)
  throw Error("FX inventory actor set differs from selected scene");
const binsBySha = new Map(),
  binOwners = new Map();
for (const entry of inventory.objects)
  binOwners.set(
    `${entry.wad.toLowerCase()}:${entry.file.toLowerCase()}`,
    entry.sourceSha256,
  );
for (const file of selectedInventory.keys()) {
  if (!/^bins\/\d+\.typed\.json$/.test(file)) continue;
  const prefix = file.slice(0, -".typed.json".length),
    tree = decode(await readInventory(file)),
    raw = await readInventory(`${prefix}.bin`),
    normalized = decode(await readInventory(`${prefix}.json`));
  if (
    sha(raw) !== tree.sourceSha256 ||
    tree.build !== scene.build ||
    tree.reader !== "scout-exact-property-bin-16.21"
  )
    throw Error("FX original BIN source identity differs");
  const original = readExactMapBin(raw, scene.build);
  if (
    stringifyAssetJson(original) !== stringifyAssetJson(tree) ||
    stringifyAssetJson(normalizeActorBin(original, names)) !==
      stringifyAssetJson(normalized)
  )
    throw Error(
      "FX typed or normalized definition differs from original BIN bytes",
    );
  const old = binsBySha.get(tree.sourceSha256);
  if (
    old &&
    stringifyAssetJson(old.normalized) !== stringifyAssetJson(normalized)
  )
    throw Error("Contradictory normalized FX source");
  binsBySha.set(tree.sourceSha256, {
    sourceSha256: tree.sourceSha256,
    normalized,
  });
}
const dependencies = new Map(
    inventory.dependencies.map((entry) => [
      `${entry.type}:${entry.value}`,
      entry,
    ]),
  ),
  assetRequests = new Map(),
  definitions = {},
  actors = {},
  unsupportedReferences = [];
function assetKey(type, value) {
  return type === "String"
    ? value
    : `wad-hash/${BigInt(value).toString(16).padStart(16, "0")}`;
}
function convertReferences(value) {
  if (Array.isArray(value)) return value.map(convertReferences);
  if (value && typeof value === "object") {
    if (value.kind === "wad-path-hash")
      return assetKey("WadChunkLink", value.value);
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        convertReferences(child),
      ]),
    );
  }
  return value;
}
for (const row of inventory.actors) {
  const asset = actorAssets.get(row.actor);
  if (
    asset.character !== row.character ||
    asset.skinId !== row.skinId ||
    asset.source.skinSha256 !== row.skinSource
  )
    throw Error("FX appearance source differs from selected scene");
  const bins = row.bins.flatMap((id) => {
      const digest = binOwners.get(id.toLowerCase());
      // An empty original BIN contributes no definitions.
      if (!digest) return [];
      const bin = binsBySha.get(digest);
      if (!bin) throw Error("FX inventory omitted original BIN bytes");
      const separator = id.indexOf(":");
      return [
        { ...bin, wad: id.slice(0, separator), file: id.slice(separator + 1) },
      ];
    }),
    index = createArchivedFxObjectIndex(bins),
    spells = decode(await readScene(asset.spellCatalog)),
    actor = compileArchivedFxActor({
      character: row.character,
      skinId: row.skinId,
      index,
      spells: spells.spells,
    });
  const queue = [],
    visited = new Set();
  for (const collection of [actor.resources, actor.missiles])
    for (const binding of Object.values(collection))
      if (binding.definitionId) {
        binding.effectId = `${row.actor}/${binding.definitionId}`;
        queue.push(binding.definitionId);
        delete binding.definitionId;
      }
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    const selected = index.select(`{${id}}`);
    if (selected.status !== "exact-original-object")
      throw Error("Prepared FX definition lost its original object");
    const effectId = `${row.actor}/${id}`,
      definition = convertReferences(selected.value),
      refs = [],
      assets = new Map();
    function walk(value, trail) {
      if (Array.isArray(value)) {
        value.forEach((child, position) =>
          walk(child, `${trail}[${position}]`),
        );
        return;
      }
      if (value && typeof value === "object") {
        for (const [field, child] of Object.entries(value))
          if (
            ![
              "__type",
              "objectPath",
              "particleName",
              "particlePath",
              "emitterName",
            ].includes(field)
          )
            walk(child, `${trail}.${field}`);
        return;
      }
      if (typeof value !== "string" || !value.length) return;
      const physical = /^(assets|data)\/.+\.[a-z\d_]+$/i.test(value),
        hashed = /^wad-hash\/[a-f\d]{16}$/.test(value);
      if (physical || hashed) {
        const key = value.toLowerCase(),
          type = physical ? "String" : "WadChunkLink",
          original = physical ? key : BigInt(`0x${key.slice(9)}`).toString();
        assets.set(key, { property: trail, path: key });
        assetRequests.set(key, { type, value: original });
        return;
      }
      const alias = actor.resources[actorObjectHash(value)],
        target =
          alias?.effectId?.split("/").at(-1) ??
          (index.has(value) ? actorObjectHash(value) : null);
      if (!target) return;
      const child = index.select(`{${target}}`);
      if (child.status !== "exact-original-object") {
        unsupportedReferences.push({
          effectId,
          property: trail,
          target,
          status: child.status,
        });
        return;
      }
      refs.push({
        property: trail,
        effectId: `${row.actor}/${target}`,
        status: "reference; activation semantics unresolved",
      });
      queue.push(target);
    }
    walk(definition, "");
    definitions[effectId] = {
      id,
      actor: row.actor,
      sourceBins: selected.candidates,
      definition,
      dependencies: [...assets.values()],
      references: refs,
    };
  }
  actors[row.actor] = actor;
  console.log(
    JSON.stringify({
      actor: row.actor,
      definitions: visited.size,
      unresolved: actor.unresolved.length,
    }),
  );
}
const assets = {},
  textureJobs = {},
  meshJobs = [],
  conversions = new Map();
for (const [key, reference] of assetRequests) {
  const source = dependencies.get(`${reference.type}:${reference.value}`);
  if (
    !source ||
    source.status !== "original-bytes-retained-no-format-admission"
  ) {
    assets[key] = {
      kind: "unresolved",
      status: "unprepared",
      reason:
        source?.status ?? "Asset outside captured FX dependency inventory",
      sourceReference: reference,
    };
    continue;
  }
  const digests = new Set(source.candidates.map((entry) => entry.sha256));
  if (digests.size !== 1 || !source.candidates.length)
    throw Error("FX source candidates lost exact byte agreement");
  const candidate = source.candidates[0],
    bytes = await readInventory(candidate.file),
    format = identifyArchivedFxFormat(bytes),
    rawFile = `raw/${candidate.sha256}.${format.format}`;
  if (!written.has(rawFile)) await write(rawFile, bytes);
  const supported = ["pinned-texture-mip0", "pinned-static-mesh"].includes(
      format.translation,
    ),
    file = supported
      ? `${format.translation === "pinned-texture-mip0" ? "textures" : "meshes"}/${candidate.sha256}.${format.translation === "pinned-texture-mip0" ? "png" : "json"}`
      : null;
  assets[key] = {
    kind:
      format.translation === "pinned-texture-mip0"
        ? "texture"
        : format.translation === "pinned-static-mesh"
          ? "static-mesh"
          : format.format,
    status: supported ? "prepared" : "unprepared",
    ...(file ? { file } : { reason: format.translation }),
    sourceSha256: candidate.sha256,
    sourceReference: reference,
    sourceCandidates: source.candidates,
    rawFile,
    format,
  };
  if (file && !conversions.has(file)) {
    conversions.set(file, true);
    await mkdir(path.dirname(path.join(out, file)), { recursive: true });
    if (format.translation === "pinned-texture-mip0")
      textureJobs[path.join(out, rawFile)] = path.join(out, file);
    else
      meshJobs.push([
        "effect-mesh",
        path.join(out, rawFile),
        path.join(out, file),
      ]);
  }
}
async function command(args) {
  const child = Bun.spawn([dotnet, exporter, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    }),
    [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
  if (code !== 0)
    throw Error(
      `Declared archived FX conversion failed(${code}): ${stdout}\n${stderr}`,
    );
}
if (Object.keys(textureJobs).length) {
  const jobs = path.join(work, "textures.json");
  await Bun.write(jobs, json(textureJobs));
  await command(["textures", jobs]);
}
let next = 0;
const workers = await Promise.allSettled(
  Array.from({ length: Math.min(4, meshJobs.length) }, async () => {
    while (next < meshJobs.length) await command(meshJobs[next++]);
  }),
);
const failed = workers.find((entry) => entry.status === "rejected");
if (failed) throw failed.reason;
for (const asset of Object.values(assets))
  if (asset.file) {
    const bytes = await Bun.file(path.join(out, asset.file)).bytes();
    asset.bytes = bytes.length;
    asset.sha256 = sha(bytes);
    written.set(asset.file, {
      path: asset.file,
      bytes: bytes.length,
      sha256: asset.sha256,
    });
    if (asset.kind === "texture") {
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      );
      if (
        bytes.length < 24 ||
        view.getUint32(0) !== 0x89504e47 ||
        view.getUint32(12) !== 0x49484452
      )
        throw Error("Invalid archived FX PNG");
      asset.width = view.getUint32(16);
      asset.height = view.getUint32(20);
      if (
        asset.width !== asset.format.width ||
        asset.height !== asset.format.height
      )
        throw Error("Archived FX texture dimensions changed");
    } else {
      const mesh = decode(bytes);
      if (
        !mesh.positions?.length ||
        mesh.positions.length % 9 ||
        mesh.uv?.length * 3 !== mesh.positions.length * 2 ||
        ![...mesh.positions, ...mesh.uv].every(Number.isFinite)
      )
        throw Error("Invalid archived FX static mesh");
      asset.triangles = mesh.positions.length / 9;
    }
  }
const runtimeDefinitions = {};
for (const [id, definition] of Object.entries(definitions)) {
  const bytes = json(definition),
    file = `definitions/${sha(bytes)}.json`;
  if (!written.has(file)) await write(file, bytes);
  runtimeDefinitions[id] = {
    file,
    sha256: sha(bytes),
    actor: definition.actor,
    class: definition.definition.__type,
    complexEmitters: (
      archivedFxField(definition.definition, "complexEmitterDefinitionData") ??
      []
    ).length,
    simpleEmitters: (
      archivedFxField(definition.definition, "simpleEmitterDefinitionData") ??
      []
    ).length,
    dependencies: definition.dependencies,
    references: definition.references,
  };
}
await write(
  "original-reference-inventory.json",
  json({
    sourceManifestSha256: sha(inventoryBytes),
    unsupportedReferences,
    sourceInventory: inventoryManifest.inventory,
    resourceReferencePolicy:
      "original unsigned WAD hash represented by explicit wad-hash/<16hex> runtime key; physical string paths unchanged",
  }),
);
const summary = {
  actors: Object.keys(actors).length,
  parsedBins: binsBySha.size,
  effects: Object.values(runtimeDefinitions).filter(
    (entry) =>
      actorObjectHash(entry.class) ===
      actorObjectHash("VfxSystemDefinitionData"),
  ).length,
  linkedDefinitions: Object.values(runtimeDefinitions).filter(
    (entry) =>
      actorObjectHash(entry.class) !==
      actorObjectHash("VfxSystemDefinitionData"),
  ).length,
  textureFiles: Object.keys(textureJobs).length,
  staticMeshes: meshJobs.length,
  unpreparedAssets: Object.values(assets).filter(
    (entry) => entry.status === "unprepared",
  ).length,
  unresolvedResourceReferences: Object.values(actors).reduce(
    (total, entry) => total + entry.unresolved.length,
    0,
  ),
  preparedMissileBindings: Object.values(actors)
    .flatMap((entry) => Object.values(entry.missiles))
    .filter((entry) => entry.status === "prepared-definition").length,
};
const packageData = {
  schema: 1,
  kind: "archived-map11-partial-effects",
  build: scene.build,
  protocol: scene.protocol,
  sceneManifestSha256: sha(sceneBytes),
  sourceInventorySha256: sha(inventoryBytes),
  summary,
  actors,
  definitions: runtimeDefinitions,
  assets,
  limitations: [
    "Static original definitions and translated 2D Mip0/static mesh resources only",
    "Original resource links do not establish activation, native materials, visibility, attachment or audio",
    "Cubemaps and animated VFX mesh dependencies stay explicitly untranslated",
  ],
  nativeSpectatorAdmitted: false,
};
for (const [file, digest] of Object.entries(compilerSources))
  if (sha(await Bun.file(new URL(file, import.meta.url)).bytes()) !== digest)
    throw Error(`Archived FX compiler source changed: ${file}`);
for (const [file, digest] of Object.entries(referenceHashes))
  if (
    sha(await Bun.file(path.join(path.dirname(exporter), file)).bytes()) !==
    digest
  )
    throw Error(`Archived FX exporter dependency changed: ${file}`);
for (const entry of consumed.values())
  await (entry.authority === "scene"
    ? readScene(entry.file)
    : readInventory(entry.file));
if (
  sha(await Bun.file(approvedReceiptFile).bytes()) !==
    sha(approvedReceiptBytes) ||
  sha(await Bun.file(path.join(sceneRoot, "manifest.json")).bytes()) !==
    sha(sceneBytes) ||
  sha(await Bun.file(path.join(inventoryRoot, "manifest.json")).bytes()) !==
    sha(inventoryBytes)
)
  throw Error("Archived FX authority changed during preparation");
if (sha(await Bun.file(metadataFile).bytes()) !== ACTOR_META_SOURCE_SHA256)
  throw Error("Original FX metadata source changed during preparation");
for (const entry of written.values()) {
  const bytes = await Bun.file(path.join(out, entry.path)).bytes();
  if (bytes.length !== entry.bytes || sha(bytes) !== entry.sha256)
    throw Error(`Archived FX output changed: ${entry.path}`);
}
await Bun.write(
  path.join(out, "manifest.json"),
  json({
    ...packageData,
    toolchain: {
      compilerSources,
      referenceHashes,
      exporterSha256: sha(await Bun.file(exporter).bytes()),
      leagueToolkitRevision: ACTOR_TOOLKIT_REVISION,
      sourceReceiptSha256: sha(approvedReceiptBytes),
    },
    consumedInputs: [...consumed.values()],
    files: [...written.values()],
  }),
);
console.log(
  JSON.stringify({ output: out, ...summary, nativeSpectatorAdmitted: false }),
);
