// Source candidates only. Context selection, pointer identity, Buff metadata
// loading and Homeguard flag interpretation remain original-native boundaries.
import path from "node:path";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import {
  ACTOR_META_SOURCE_SHA256,
  readActorMetaNames,
  normalizeActorBin,
} from "./archived-actor-bin.mjs";
import { actorSpellHash } from "./archived-actor-spells.mjs";
import { readExactMapBin } from "./exact-map-bin.mjs";
import { sceneAnimationFilePath } from "../scene-animation-authority.mjs";
import { stringifyAssetJson } from "./asset-json.mjs";

const [
  sourceArg,
  inventoryArg,
  contextsArg,
  requestsArg,
  cacheArg,
  mapDefinitionArg,
  sharedSourcesArg,
] = process.argv.slice(2);
if (!cacheArg)
  throw Error(
    "Usage: bun inventory-recorded-buff-sources.mjs <approved-source-cache> <fx-source-inventory> <effect-resource-package> <recorded-buff-requests.json> <archive-cache> [original-map-definition.bin] [closed-shared-source-candidates]",
  );
const { sourceCache, out } = await createStaticPreparationOutput(
    sourceArg,
    cacheArg,
    { prefix: "buff-sources-", directory: "buff-sources" },
  ),
  inventoryRoot = path.resolve(inventoryArg),
  inputBytes = await Bun.file(
    path.join(inventoryRoot, "manifest.json"),
  ).bytes(),
  input = JSON.parse(new TextDecoder().decode(inputBytes)),
  requestsBytes = await Bun.file(requestsArg).bytes(),
  request = JSON.parse(new TextDecoder().decode(requestsBytes)),
  contextBytes = await Bun.file(
    path.join(contextsArg, "contexts.json"),
  ).bytes(),
  contexts = JSON.parse(new TextDecoder().decode(contextBytes)),
  metadataPath = path.join(
    sourceCache,
    "research/LeagueToolkit/src/LeagueToolkit.Meta.Classes/Classes.cs",
  ),
  metadataBytes = await Bun.file(metadataPath).bytes(),
  selected = new Map(input.files.map((entry) => [entry.file, entry])),
  consumed = new Map(),
  written = [],
  compilerSources = {};
const decode = (bytes) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  json = (value) => new TextEncoder().encode(stringifyAssetJson(value)),
  ascii = (value) => typeof value === "string" && /^[\x01-\x7f]*$/.test(value);
if (
  input.kind !== "archived-map11-fx-source-inventory" ||
  request.kind !== "recorded-buff-resource-requests" ||
  request.schema !== 1 ||
  request.build !== input.build ||
  request.protocol !== input.protocol ||
  request.sceneManifestSha256 !== input.sceneManifestSha256 ||
  contexts.effectsManifestSha256 === undefined ||
  contexts.sceneManifestSha256 !== request.sceneManifestSha256 ||
  contexts.decoderImageSha256 !== request.decoderImageSha256 ||
  sha(metadataBytes) !== ACTOR_META_SOURCE_SHA256 ||
  !Array.isArray(request.requests)
)
  throw Error("Exact matching original buff request/source context required");
if (
  sha(
    await Bun.file(
      new URL("archived-actor-spells.mjs", import.meta.url),
    ).bytes(),
  ) !== "f4d1ca8ddd638d1b7abb4304909343ec29c63fc3a3dffc8f0b3454a4b30e3fc6"
)
  throw Error("Original native-compared ASCII ELF helper changed");
for (const file of [
  "inventory-recorded-buff-sources.mjs",
  "archived-actor-spells.mjs",
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
async function read(file) {
  sceneAnimationFilePath(file);
  const expected = selected.get(file);
  if (!expected) throw Error("Unselected original buff source");
  const bytes = await Bun.file(path.join(inventoryRoot, file)).bytes();
  if (bytes.length !== expected.bytes || sha(bytes) !== expected.sha256)
    throw Error("Original buff BIN source changed");
  consumed.set(file, { file, bytes: bytes.length, sha256: sha(bytes) });
  return bytes;
}
async function write(file, bytes) {
  await Bun.write(path.join(out, file), bytes);
  written.push({ file, bytes: bytes.length, sha256: sha(bytes) });
}
const names = readActorMetaNames(new TextDecoder().decode(metadataBytes)),
  source = decode(await read(input.inventory)),
  origins = new Map(),
  scopes = new Map();
for (const object of source.objects) {
  const rows = origins.get(object.sourceSha256) ?? [];
  if (!rows.some((row) => row.file === object.file && row.wad === object.wad))
    rows.push({ file: object.file, wad: object.wad });
  origins.set(object.sourceSha256, rows);
}
for (const actor of source.actors)
  for (const id of actor.bins) {
    const origin = source.objects.find(
      (entry) =>
        `${entry.wad.toLowerCase()}:${entry.file.toLowerCase()}` ===
        id.toLowerCase(),
    );
    if (!origin) continue;
    const rows = scopes.get(origin.sourceSha256) ?? new Set();
    rows.add(actor.actor);
    scopes.set(origin.sourceSha256, rows);
  }
const candidates = [],
  bins = [],
  unsupportedNames = [];
async function scan(raw, originRows, actorScopes) {
  const sourceSha256 = sha(raw),
    tree = readExactMapBin(raw, input.build, { captureFieldSpans: true }),
    index = bins.length,
    rawFile = `bin-${index}.bin`,
    typedFile = `bin-${index}.typed.json`,
    namedFile = `bin-${index}.json`;
  await write(rawFile, raw);
  await write(typedFile, json(tree));
  await write(namedFile, json(normalizeActorBin(tree, names)));
  bins.push({
    sourceSha256,
    rawFile,
    typedFile,
    namedFile,
    origins: originRows,
    actorScopes,
    objects: tree.objects.length,
  });
  for (const node of tree.objects) {
    function structure(owner, trail) {
      for (const [fieldHash, property] of Object.entries(owner.fields)) {
        const field = names.fieldName(owner.classHash, fieldHash),
          next = [...trail, "fields", fieldHash];
        if (["ObjectName", "mScriptName"].includes(field)) {
          const base = {
            sourceSha256,
            rawFile,
            typedFile,
            namedFile,
            origins: originRows,
            actorScopes,
            ownerPathHash: node.pathHash,
            rootClassHash: node.classHash,
            immediateClassHash: owner.classHash,
            classNameAnnotation: names.className(owner.classHash),
            fieldHash,
            fieldNameAnnotation: field,
            originalType: property.type,
            trail: next,
          };
          if (property.type !== "String" || !ascii(property.value))
            unsupportedNames.push({
              ...base,
              reason:
                "Original name field is not an ASCII string; no inferred spelling/hash",
            });
          else
            candidates.push({
              ...base,
              name: property.value,
              resourceNameHash: actorSpellHash(property.value),
            });
        }
        visit(property, next);
      }
    }
    function visit(property, trail) {
      if (["Struct", "Embedded"].includes(property.type))
        structure(property, trail);
      else if (["Container", "UnorderedContainer"].includes(property.type))
        property.elements.forEach((value, index) =>
          visit(value, [...trail, "elements", index]),
        );
      else if (property.type === "Map")
        property.entries.forEach((entry, index) => {
          visit(entry.key, [...trail, "entries", index, "key"]);
          visit(entry.value, [...trail, "entries", index, "value"]);
        });
      else if (property.type === "Optional" && property.value !== null)
        visit(property.value, [...trail, "value"]);
    }
    structure(node, []);
  }
}
for (const file of selected.keys())
  if (/^bins\/\d+\.typed\.json$/.test(file)) {
    const typed = decode(await read(file)),
      raw = await read(file.replace(".typed.json", ".bin"));
    if (sha(raw) !== typed.sourceSha256)
      throw Error("Original buff typed/raw source differs");
    await scan(raw, origins.get(typed.sourceSha256) ?? [], [
      ...(scopes.get(typed.sourceSha256) ?? []),
    ]);
  }
let mapInput = null;
if (mapDefinitionArg) {
  const raw = await Bun.file(mapDefinitionArg).bytes();
  mapInput = {
    file: path.resolve(mapDefinitionArg),
    bytes: raw.length,
    sha256: sha(raw),
  };
  await scan(raw, [{ file: "original-map-definition", source: mapInput }], []);
}
let sharedInput = null;
if (sharedSourcesArg) {
  const manifestBytes = await Bun.file(
      path.join(sharedSourcesArg, "manifest.json"),
    ).bytes(),
    manifest = decode(manifestBytes);
  if (
    manifest.kind !== "archived-original-shared-buff-source-candidates" ||
    manifest.build !== input.build ||
    manifest.protocol !== input.protocol ||
    manifest.requestSha256 !== sha(requestsBytes) ||
    manifest.nativeSpectatorAdmitted !== false
  )
    throw Error("Exact original Shared source candidates required");
  sharedInput = {
    file: path.resolve(sharedSourcesArg, "manifest.json"),
    sha256: sha(manifestBytes),
    bytes: manifestBytes.length,
  };
  const files = new Map(manifest.files.map((file) => [file.file, file]));
  for (const record of manifest.records)
    if (record.rawFile) {
      sceneAnimationFilePath(record.rawFile);
      const expected = files.get(record.rawFile),
        raw = await Bun.file(
          path.join(sharedSourcesArg, record.rawFile),
        ).bytes();
      if (
        !expected ||
        raw.length !== expected.bytes ||
        sha(raw) !== expected.sha256 ||
        expected.sha256 !== record.sourceSha256
      )
        throw Error("Original Shared source bytes changed");
      await scan(
        raw,
        [
          {
            file: record.file,
            wad: record.wad,
            requestedBy: record.requestedBy,
            sourceManifestSha256: sharedInput.sha256,
          },
        ],
        [],
      );
    }
}
const byContext = new Map(contexts.contexts.map((row) => [row.identity, row])),
  byHash = new Map();
for (const candidate of candidates) {
  const rows = byHash.get(candidate.resourceNameHash) ?? [];
  rows.push(candidate);
  byHash.set(candidate.resourceNameHash, rows);
}
const requests = request.requests.map((row) => {
  if (
    !Number.isSafeInteger(row.contextId) ||
    row.contextId < 0 ||
    row.contextId > 0xffffffff ||
    !Number.isSafeInteger(row.resourceNameHash) ||
    row.resourceNameHash < 0 ||
    row.resourceNameHash > 0xffffffff
  )
    throw Error("Original unsigned buff descriptor fields required");
  const context = byContext.get(row.contextId),
    shared = row.contextId === 3579051965,
    matches = byHash.get(row.resourceNameHash) ?? [];
  return {
    ...row,
    contextStatus: context
      ? "proved-character-context"
      : shared
        ? "original-shared-context"
        : "unknown-context",
    contextActorAliases: context?.actorAliases ?? [],
    candidates: matches.map((candidate) => ({
      ...candidate,
      inKnownCharacterSourceClosure:
        !!context &&
        candidate.actorScopes.some((key) => context.actorAliases.includes(key)),
      namespaceBinding: "unproved-source-existence-only",
    })),
    nativeLookupExecuted: false,
    resourcePointerIdentityResolved: false,
    metadataFlagsAdmitted: false,
  };
});
await write(
  "inventory.json",
  json({
    schema: 1,
    kind: "recorded-buff-original-source-candidates",
    build: request.build,
    protocol: request.protocol,
    sceneManifestSha256: request.sceneManifestSha256,
    requestSha256: sha(requestsBytes),
    effectContextsSha256: sha(contextBytes),
    originalSourceInventorySha256: sha(inputBytes),
    sharedSourceManifest: sharedInput,
    bins,
    candidates,
    unsupportedNames,
    requests,
    hashPolicy: "original-144b3a0-ASCII-A-Z-to-a-z-ELF",
    metadataNameAnnotationSourceSha256: ACTOR_META_SOURCE_SHA256,
    scope: {
      completeOriginalObjectsRetained: true,
      spellObjectsWithoutMSpellRetained: true,
      unknownRootFieldsRetained: true,
      collisionsRetained: true,
      unknownContextSharedFallback: false,
      nativeResourceLookup: false,
      buffMetadataTypeAdmitted: false,
      homeguardFlagsAdmitted: false,
    },
  }),
);
for (const entry of consumed.values()) await read(entry.file);
for (const [file, digest] of Object.entries(compilerSources))
  if (sha(await Bun.file(new URL(file, import.meta.url)).bytes()) !== digest)
    throw Error("Buff source inventory compiler changed");
if (
  sha(await Bun.file(requestsArg).bytes()) !== sha(requestsBytes) ||
  sha(await Bun.file(path.join(contextsArg, "contexts.json")).bytes()) !==
    sha(contextBytes) ||
  sha(await Bun.file(path.join(inventoryRoot, "manifest.json")).bytes()) !==
    sha(inputBytes) ||
  (mapInput &&
    sha(await Bun.file(mapInput.file).bytes()) !== mapInput.sha256) ||
  (sharedInput &&
    sha(await Bun.file(sharedInput.file).bytes()) !== sharedInput.sha256)
)
  throw Error("Original buff inventory authority changed");
await Bun.write(
  path.join(out, "manifest.json"),
  json({
    schema: 1,
    kind: "original-buff-source-candidate-authority",
    build: request.build,
    protocol: request.protocol,
    sceneManifestSha256: request.sceneManifestSha256,
    requestSha256: sha(requestsBytes),
    inventory: "inventory.json",
    compilerSources,
    files: written,
    nativeSpectatorAdmitted: false,
  }),
);
console.log(
  JSON.stringify({
    output: out,
    bins: bins.length,
    namedCandidates: candidates.length,
    requests: requests.length,
    nameHashMatches: requests.filter((entry) => entry.candidates.length).length,
    knownContextClosureMatches: requests.filter((entry) =>
      entry.candidates.some(
        (candidate) => candidate.inKnownCharacterSourceClosure,
      ),
    ).length,
    sharedRequests: requests.filter(
      (entry) => entry.contextStatus === "original-shared-context",
    ).length,
    nativeLookupExecuted: false,
  }),
);
