// Source-backed closure inventory only. This does not publish renderable FX.
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import {
  openArchivedActorSources,
  actorSha256 as sha,
} from "./archived-actor-sources.mjs";
import {
  compileOriginalFxInventory,
  originalFxPath,
} from "./archived-fx-inventory.mjs";
import { readExactMapBin } from "./exact-map-bin.mjs";
import {
  readActorMetaNames,
  normalizeActorBin,
} from "./archived-actor-bin.mjs";
import { sceneAnimationFilePath } from "../scene-animation-authority.mjs";
import { stringifyAssetJson } from "./asset-json.mjs";

const [parserCheckout, sourceArg, archiveArg, sceneArg] = process.argv.slice(2);
if (!sceneArg)
  throw Error(
    "Usage: bun inspect-archived-scene-effects.mjs <parser-checkout> <approved-source-cache> <archive-cache> <closed-common-scene>",
  );
const paths = await createStaticPreparationOutput(sourceArg, archiveArg, {
    prefix: "fx-inventory-",
    directory: "fx-inventory",
  }),
  sceneRoot = path.resolve(sceneArg),
  sceneBytes = await Bun.file(path.join(sceneRoot, "manifest.json")).bytes(),
  scene = JSON.parse(new TextDecoder().decode(sceneBytes));
if (
  scene.kind !== "archived-map11-common-runtime-scene" ||
  scene.build !== "16.21.829.8620" ||
  scene.protocol !== "20e09df23c66b85e" ||
  scene.map?.id !== 11 ||
  !Array.isArray(scene.files)
)
  throw Error("Exact closed archived Map11 common scene required");
const selected = new Map(),
  consumed = new Map(),
  written = [],
  sources = new Map();
for (const file of scene.files) {
  sceneAnimationFilePath(file.path);
  if (selected.has(file.path)) throw Error("Duplicate selected scene file");
  selected.set(file.path, file);
}
async function readScene(file) {
  sceneAnimationFilePath(file);
  const entry = selected.get(file),
    bytes = await Bun.file(path.join(sceneRoot, file)).bytes();
  if (!entry || bytes.length !== entry.bytes || sha(bytes) !== entry.sha256)
    throw Error(`Selected scene source changed: ${file}`);
  consumed.set(file, { file, bytes: bytes.length, sha256: sha(bytes) });
  return bytes;
}
async function write(file, bytes) {
  sceneAnimationFilePath(file);
  await mkdir(path.dirname(path.join(paths.out, file)), { recursive: true });
  await Bun.write(path.join(paths.out, file), bytes);
  written.push({ file, bytes: bytes.length, sha256: sha(bytes) });
}
const json = (value) => new TextEncoder().encode(stringifyAssetJson(value));
for (const file of [
  "inspect-archived-scene-effects.mjs",
  "archived-fx-inventory.mjs",
  "archived-actor-sources.mjs",
  "archived-actor-bin.mjs",
  "archived-actor-native-maps.mjs",
  "native-actor-map-bridge.mjs",
  "native-clip-map-policy.mjs",
  "native-event-map-policy.mjs",
  "exact-map-bin.mjs",
  "map-scene-assets.mjs",
  "map-scene-output.mjs",
  "wad.mjs",
  "rman-chunks.mjs",
  "asset-json.mjs",
  "../scene-animation-authority.mjs",
])
  sources.set(
    file,
    sha(await Bun.file(new URL(file, import.meta.url)).bytes()),
  );
const source = await openArchivedActorSources({
    parserCheckout,
    sourceCache: paths.sourceCache,
    archiveCache: paths.cache,
  }),
  metadataBytes = await Bun.file(
    path.join(
      paths.sourceCache,
      "research/LeagueToolkit/src/LeagueToolkit.Meta.Classes/Classes.cs",
    ),
  ).bytes(),
  names = readActorMetaNames(
    new TextDecoder("utf-8", { fatal: true }).decode(metadataBytes),
  ),
  world = JSON.parse(new TextDecoder().decode(await readScene(scene.world))),
  actors = [
    ...Object.entries(scene.champions).map(([key, asset]) => ({
      key: `champions/${key}`,
      asset,
    })),
    ...Object.entries(world.assets).map(([key, asset]) => ({
      key: `world/${key}`,
      asset,
    })),
  ],
  archiveNames = [
    ...new Set([
      ...actors.map(({ asset }) => asset.source.wad),
      "DATA/FINAL/Maps/Shipping/Map11.wad.client",
      "DATA/FINAL/Global.wad.client",
      "DATA/FINAL/DATA.wad.client",
    ]),
  ],
  archives = new Map();
if (sha(metadataBytes) !== source.toolchain.metadataNamesSha256)
  throw Error("Pinned actor metadata source changed");
for (const name of archiveNames) archives.set(name, await source.wad(name));
const bins = new Map(),
  actorRows = [],
  missing = [];
for (const { key, asset } of actors) {
  const pending = asset.source.bins.map((entry) => ({
      file: entry.path,
      expectedSha256: entry.sha256,
    })),
    expectedSources = new Map(
      asset.source.bins.map((entry) => [
        entry.path.toLowerCase(),
        entry.sha256,
      ]),
    ),
    visited = new Set(),
    ids = [];
  while (pending.length) {
    const { file } = pending.shift(),
      lower = originalFxPath(file),
      expectedSha256 = expectedSources.get(lower);
    sceneAnimationFilePath(lower);
    if (visited.has(lower)) continue;
    if (visited.size >= 1024 || bins.size >= 8192)
      throw Error("Archived FX BIN closure exceeds bounds");
    visited.add(lower);
    // Scope is declared archives, not a guessed override ordering.
    const owners = archiveNames.filter(
      (name) =>
        (name === asset.source.wad || !name.includes("/Champions/")) &&
        archives.get(name).has(lower),
    );
    if (!owners.length) {
      missing.push({
        actor: key,
        file,
        status: "missing-from-declared-archives",
      });
      continue;
    }
    for (const wad of owners) {
      const id = `${wad.toLowerCase()}:${lower}`;
      let bin = bins.get(id);
      if (!bin) {
        // One generic namespace route: exact original path -> unsigned WAD
        // hash. Multi_Skins names never become operating-system filenames.
        const bytes = await source.read(wad, {
            kind: "wad-path-hash",
            value: Bun.hash.xxHash64(lower).toString(),
          }),
          tree = readExactMapBin(bytes, scene.build),
          original = {
            file,
            bytes,
            tree,
            normalized: normalizeActorBin(tree, names),
          },
          sourceSha256 = sha(original.bytes);
        if (
          wad === asset.source.wad &&
          expectedSha256 &&
          sourceSha256 !== expectedSha256
        )
          throw Error(
            `Original actor FX source differs from selected scene: ${id}`,
          );
        const index = bins.size,
          raw = `bins/${index}.bin`,
          typed = `bins/${index}.typed.json`,
          normalized = `bins/${index}.json`;
        await write(raw, original.bytes);
        await write(typed, json(original.tree));
        await write(normalized, json(original.normalized));
        bin = { ...original, wad, raw, typed, normalizedFile: normalized };
        bins.set(id, bin);
      } else if (
        wad === asset.source.wad &&
        expectedSha256 &&
        bin.tree.sourceSha256 !== expectedSha256
      )
        throw Error(
          `Original actor FX source differs from selected scene: ${id}`,
        );
      ids.push(id);
      for (const dependency of bin.tree.dependencies)
        pending.push({ file: dependency });
    }
  }
  actorRows.push({
    actor: key,
    character: asset.character,
    skinId: asset.skinId,
    skinSource: asset.source.skinSha256,
    bins: ids,
  });
  console.log(
    JSON.stringify({ actor: key, bins: ids.length, status: "inventoried" }),
  );
}
const inventory = compileOriginalFxInventory([...bins.values()]),
  dependencies = new Map();
// Keep every VFX system in the original actor dependency closure. Whether a
// resolver or replay activates it is a separate native consumer boundary.
for (const effect of inventory.effects)
  for (const reference of effect.references)
    if (reference.type === "String" || reference.type === "WadChunkLink") {
      const key = `${reference.type}:${reference.value}`,
        old = dependencies.get(key) ?? {
          type: reference.type,
          value: reference.value,
          uses: [],
        };
      old.uses.push({
        effect: effect.pathHash,
        sourceSha256: effect.sourceSha256,
        wad: effect.wad,
        trail: reference.trail,
      });
      dependencies.set(key, old);
    }
for (const dependency of dependencies.values()) {
  const owners = [];
  for (const [wad, archive] of archives) {
    if (dependency.type === "String") {
      if (archive.has(dependency.value))
        owners.push({ wad, bytes: await source.read(wad, dependency.value) });
    } else {
      try {
        owners.push({
          wad,
          bytes: await source.read(wad, {
            kind: "wad-path-hash",
            value: dependency.value,
          }),
        });
      } catch (error) {
        // This exact absence is an inventory state. Integrity/decompression/
        // network failures remain fatal and are never a routing fallback.
        const label = BigInt(dependency.value).toString(16).padStart(16, "0");
        if (error.message !== `Missing WAD path hash ${label}`) throw error;
      }
    }
  }
  dependency.candidates = [];
  for (const owner of owners) {
    const digest = sha(owner.bytes),
      file = `assets/${digest}.raw`;
    if (!written.some((entry) => entry.file === file))
      await write(file, owner.bytes);
    dependency.candidates.push({
      wad: owner.wad,
      file,
      sha256: digest,
      bytes: owner.bytes.length,
    });
  }
  dependency.status = !owners.length
    ? "missing-from-declared-archives"
    : new Set(dependency.candidates.map((entry) => entry.sha256)).size > 1
      ? "unsupported-archive-precedence"
      : "original-bytes-retained-no-format-admission";
}
await write(
  "inventory.json",
  json({
    actors: actorRows,
    ...inventory,
    dependencies: [...dependencies.values()],
    missingBins: missing,
  }),
);
for (const [file, digest] of sources)
  if (sha(await Bun.file(new URL(file, import.meta.url)).bytes()) !== digest)
    throw Error(`FX inventory producer source changed: ${file}`);
for (const entry of consumed.values()) await readScene(entry.file);
if (
  sha(await Bun.file(path.join(sceneRoot, "manifest.json")).bytes()) !==
  sha(sceneBytes)
)
  throw Error("Selected scene manifest changed");
for (const entry of written) {
  const bytes = await Bun.file(path.join(paths.out, entry.file)).bytes();
  if (bytes.length !== entry.bytes || sha(bytes) !== entry.sha256)
    throw Error(`FX inventory output changed: ${entry.file}`);
}
const manifest = {
  schema: 1,
  kind: "archived-map11-fx-source-inventory",
  build: scene.build,
  protocol: scene.protocol,
  sceneManifestSha256: sha(sceneBytes),
  sourceToolchain: source.toolchain,
  compilerSources: Object.fromEntries(sources),
  consumedSceneFiles: [...consumed.values()],
  inventory: "inventory.json",
  files: written,
  provenance: source.provenance(),
  rmanReceipts: source.receipts(),
  capabilities: {
    activation: "unadmitted",
    formatTranslation: "unadmitted",
    rendering: "unadmitted",
    eventScheduling: "unadmitted",
  },
  nativeSpectatorAdmitted: false,
};
await Bun.write(path.join(paths.out, "manifest.json"), json(manifest));
console.log(
  JSON.stringify({
    output: paths.out,
    actors: actors.length,
    bins: bins.size,
    effects: inventory.effects.length,
    conflictingObjects: inventory.conflicts.length,
    dependencies: dependencies.size,
    missingBins: missing.length,
    missingAssets: [...dependencies.values()].filter(
      (entry) => entry.status === "missing-from-declared-archives",
    ).length,
    nativeSpectatorAdmitted: false,
  }),
);
