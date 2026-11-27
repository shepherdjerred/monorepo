// Private, offline extraction of the exact opening hero skin resources.
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { prepareReplayForSeek } from "../../../../../packages/scout-for-lol/packages/replay/src/prepare.ts";
import { readExactMapBin } from "./exact-map-bin.mjs";
import { mapBinHash } from "./map-scene-assets.mjs";
import {
  bindNativeTerrainChampionIdentities,
  createNativeTerrainChampionCreation88Reader,
} from "./research/native-terrain-champion-identities.mjs";
import { createExactTerrainByteCodecs } from "./research/native-terrain-positions-944.mjs";
import {
  archivedChampionBuild,
  championArchiveExecutableHashes,
  currentChampionBuild,
  verifyNativeCatalogOpening,
} from "./research/native-terrain-champion-model-catalog.mjs";
import { openLocalWad } from "./wad.mjs";

const installedExeSha256 =
  championArchiveExecutableHashes[archivedChampionBuild];
const protocol = "8bbfcd5af2bc92db";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inflate = (input, output) =>
  zstdDecompressSync(input, { maxOutputLength: output.byteLength });
const field = (node, name) => node?.fields[mapBinHash(name)];
const args = process.argv.slice(2);
const census = args[0] === "--archive-census";
const archivedSkins = args[0] === "--prepare-archived-skins";
const [installation, replayPath, decoderPath, outputPath] = census
  ? [args[1], undefined, undefined, args[2]]
  : archivedSkins
    ? [args[1], undefined, undefined, args[6]]
    : args;
if (
  !installation ||
  !outputPath ||
  args.length !== (census ? 3 : archivedSkins ? 7 : 4)
)
  throw Error(
    [
      "Usage: bun prepare-native-terrain-champions.mjs <installation> <local ROFL> <decoder> <new .cache directory>",
      "       bun prepare-native-terrain-champions.mjs --archive-census <installation> <new .cache directory>",
      "       bun prepare-native-terrain-champions.mjs --prepare-archived-skins <installation> <census.json> <census SHA-256> <selection or native opening proof JSON> <selection or proof SHA-256> <new .cache directory>",
    ].join("\n"),
  );
const out = resolve(outputPath);
const rel = relative(resolve(".cache"), out);
if (
  !rel ||
  rel === ".." ||
  rel.startsWith(".." + sep) ||
  resolve(".cache", rel) !== out
)
  throw Error("Champion exports must stay in a private .cache directory");
// Archived extraction verifies the selected WAD indices against the pinned
// census. The executable remains required to create a census or read a replay.
const readExecutableHash = async () =>
  hash(await readFile(join(installation, "Game", "League of Legends.exe")));

if (census) {
  const executableHash = await readExecutableHash();
  const archiveBuild = Object.keys(championArchiveExecutableHashes).find(
    (candidate) =>
      championArchiveExecutableHashes[candidate] === executableHash,
  );
  assert.ok(archiveBuild, "Unreviewed installed executable for archive census");
  await writeArchiveCensus(archiveBuild, executableHash);
  process.exit(0);
}
if (archivedSkins) {
  await writeSelectedArchivedSkins();
  process.exit(0);
}
assert.equal(
  await readExecutableHash(),
  installedExeSha256,
  "Installed client differs from the reviewed replay extraction executable",
);

const replayBytes = await Bun.file(replayPath).arrayBuffer();
const prepared = prepareReplayForSeek(replayBytes, inflate);
const { observations, packetReader } = prepared;
const decoder = await readFile(decoderPath);
const codecs = createExactTerrainByteCodecs(decoder, observations);
const { binding } = bindNativeTerrainChampionIdentities(prepared, codecs);
if (binding.verified.length !== 10 || binding.unresolved.length !== 0)
  throw Error("Exact ten-participant opening bindings required");
const footerRows = new Map(
  binding.verified.map(({ context, footerRow }) => [context, footerRow]),
);
const readCreation = createNativeTerrainChampionCreation88Reader(
  observations,
  codecs,
);
const { keyframe, packets } = packetReader.read(0);
const roster = [];
let opcode = null;
for (const packet of packets) {
  if (packet.stream !== 2 || packet.chunkOffset !== keyframe.chunkOffset) break;
  opcode = packet.explicitOpcode ?? opcode;
  if (opcode !== 88) continue;
  const hero = readCreation(packet.payload, { includeSkin: true });
  const footerRow = footerRows.get(hero.context);
  if (
    !footerRow ||
    observations.roster[footerRow - 1].champion !== hero.champion
  )
    throw Error("Skin creation does not corroborate the bound replay roster");
  roster.push({ ...hero, footerRow, creationSha256: hash(packet.payload) });
}
if (
  roster.length !== 10 ||
  new Set(roster.map((row) => row.footerRow)).size !== 10
)
  throw Error("Exactly one original skin creation per participant required");

await mkdir(out);
function readReference(read, reference) {
  if (reference?.type === "WadChunkLink")
    return read.byHash(BigInt(reference.value));
  if (reference?.type === "String" && typeof reference.value === "string")
    return read(reference.value);
  throw Error("Unsupported original skin resource reference");
}
async function exportFile(directory, filename, reference, bytes) {
  await writeFile(join(out, directory, filename), bytes, { flag: "wx" });
  return {
    file: directory + "/" + filename,
    reference,
    bytes: bytes.byteLength,
    sha256: hash(bytes),
  };
}
const actors = [];
for (const hero of roster.sort(
  (left, right) => left.footerRow - right.footerRow,
)) {
  actors.push({ ...hero, ...(await exportSkin(hero.champion, hero.skinId)) });
}

async function exportSkin(champion, skinId, censusArchive, censusSkin) {
  if (
    !/^[A-Za-z0-9_]+$/.test(champion) ||
    !Number.isSafeInteger(skinId) ||
    skinId < 0 ||
    skinId > 10000
  )
    throw Error("Unresolved original skin selector");
  const directory = champion.toLowerCase() + "-" + skinId;
  const archive = `DATA/FINAL/Champions/${champion}.wad.client`;
  if (censusArchive) assert.equal(archive, censusArchive.archive);
  const read = await openLocalWad(
    installation,
    archive,
    Bun.zstdDecompressSync,
    censusArchive?.archiveIndexSha256,
  );
  const skinPath = `data/characters/${champion.toLowerCase()}/skins/skin${skinId}.bin`;
  const skinBytes = await read(skinPath);
  // Reuse the bounded PROP v3 grammar. This probe checks exact asset links
  // and does not extend the archived reader's build-specific semantic claims.
  const tree = readExactMapBin(skinBytes);
  const rootPath = `Characters/${champion}/Skins/Skin${skinId}`;
  const root = tree.objects.find(
    (node) => node.pathHash === mapBinHash(rootPath),
  );
  if (root?.classHash !== mapBinHash("SkinCharacterDataProperties"))
    throw Error(`Missing original skin root ${rootPath}`);
  const mesh = field(root, "skinMeshProperties");
  const texture = field(mesh, "texture");
  const materialOverrideCount =
    field(mesh, "materialOverride")?.elements?.length ?? 0;
  if (censusSkin) {
    assert.equal(hash(skinBytes), censusSkin.sourceSha256);
    assert.equal(root.pathHash, censusSkin.rootPathHash);
    assert.deepEqual(field(mesh, "simpleSkin"), censusSkin.simpleSkin);
    assert.deepEqual(field(mesh, "skeleton"), censusSkin.skeleton);
    assert.deepEqual(texture ?? null, censusSkin.texture);
    assert.equal(materialOverrideCount, censusSkin.materialOverrideCount);
  }
  await mkdir(join(out, directory));
  const resources = {
    skin: await exportFile(directory, "skin.bin", skinPath, skinBytes),
  };
  for (const [name, filename] of [
    ["simpleSkin", "model.skn"],
    ["skeleton", "model.skl"],
  ]) {
    const reference = field(mesh, name);
    resources[name] = await exportFile(
      directory,
      filename,
      reference,
      await readReference(read, reference),
    );
  }
  if (texture)
    resources.defaultTexture = await exportFile(
      directory,
      "default.tex",
      texture,
      await readReference(read, texture),
    );
  return {
    archive,
    rootPath,
    resources,
    skinScale: field(mesh, "skinScale")?.value ?? null,
    initialSubmeshToHide: field(mesh, "initialSubmeshToHide")?.value ?? null,
    authoredMaterialLink: field(mesh, "Material")?.value ?? null,
    materialOverrideCount,
  };
}
const manifest = JSON.stringify(
  {
    schema: 1,
    build: observations.build,
    protocol: observations.protocol,
    replaySha256: hash(new Uint8Array(replayBytes)),
    installedExeSha256,
    decoderSha256: hash(decoder),
    skinSelection:
      "Original opcode 88 skin resource index verified against the build's native Characters lookup",
    scope:
      "Opening champion mesh, rig, and authored default texture inputs. Material overrides, animation, and browser draws are separate.",
    actors,
  },
  null,
  2,
);
await writeFile(join(out, "manifest.json"), manifest, { flag: "wx" });
console.log(
  JSON.stringify({
    actors: actors.length,
    defaultTextures: actors.filter(({ resources }) => resources.defaultTexture)
      .length,
    manifestSha256: hash(manifest),
  }),
);

async function requireCanonicalPrivateOutput() {
  const cacheRoot = await realpath(".cache");
  if (
    relative(await realpath("."), cacheRoot) !== ".cache" ||
    (await realpath(dirname(out))) !== dirname(out)
  )
    throw Error(
      "Champion archive output must use a canonical private .cache path",
    );
}

async function readArchiveIndex(archive) {
  const file = Bun.file(join(installation, "Game", archive));
  const header = Buffer.from(await file.slice(0, 272).arrayBuffer());
  const archiveIndexBytes = 272 + 32 * header.readUInt32LE(268);
  const index = await file.slice(0, archiveIndexBytes).bytes();
  if (index.byteLength !== archiveIndexBytes)
    throw Error(`Truncated archive index for ${archive}`);
  return { archiveIndexBytes, archiveIndexSha256: hash(index) };
}

async function writeSelectedArchivedSkins() {
  await requireCanonicalPrivateOutput();
  const [, , censusPath, censusSha256, selectionPath, selectionSha256] = args;
  async function readPinned(path, sha256) {
    assert.match(sha256, /^[a-f0-9]{64}$/);
    const bytes = await readFile(path);
    assert.equal(hash(bytes), sha256, "Archive input digest differs");
    const value = JSON.parse(bytes);
    assert.equal(value.schema, 1);
    assert.equal(value.protocol, protocol);
    return value;
  }
  const source = await readPinned(censusPath, censusSha256);
  assert.equal(source.kind, "exact-native-terrain-archived-skin-census");
  const build = source.build;
  assert.ok(Object.hasOwn(championArchiveExecutableHashes, build));
  const executableHash = championArchiveExecutableHashes[build];
  assert.equal(source.installedExeSha256, executableHash);
  const selection = await readPinned(selectionPath, selectionSha256);
  const buildScoped = selection.kind === "exact-native-terrain-skin-selection";
  if (build === currentChampionBuild)
    assert.equal(await readExecutableHash(), executableHash);
  let nativeOpening;
  let requestedSkins;
  if (build === currentChampionBuild && !buildScoped) {
    assert.equal(
      selection.kind,
      "recorded-opening-champion-skin-native-log-proof",
    );
    assert.equal(selection.replayBuild, build);
    assert.match(selection.replaySha256, /^[a-f0-9]{64}$/);
    assert.match(selection.nativeLogSha256, /^[a-f0-9]{64}$/);
    assert.equal(selection.nativeSelectionsMatched, 10);
    requestedSkins = selection.rows;
    nativeOpening = {
      replaySha256: selection.replaySha256,
      nativeLogSha256: selection.nativeLogSha256,
      proofSha256: selectionSha256,
      rows: requestedSkins.map(({ context, champion, skinId }) => ({
        context,
        champion,
        skinId,
      })),
    };
    verifyNativeCatalogOpening(
      nativeOpening,
      requestedSkins,
      selection.replaySha256,
    );
  } else {
    assert.equal(selection.kind, "exact-native-terrain-skin-selection");
    assert.equal(selection.build, build);
    requestedSkins = selection.skins;
  }
  assert(Array.isArray(requestedSkins) && requestedSkins.length > 0);
  const archives = new Map(
    source.archiveRoots.map((archive) => [
      archive.champion.toLowerCase(),
      archive,
    ]),
  );
  assert.equal(archives.size, source.archiveRoots.length);
  const selected = new Map();
  for (const { champion, skinId } of requestedSkins) {
    assert.equal(typeof champion, "string");
    assert.match(champion, /^[a-z0-9_]+$/i);
    assert(Number.isSafeInteger(skinId) && skinId >= 0 && skinId <= 10000);
    const normalized = champion.toLowerCase();
    const archive = archives.get(normalized);
    const matches = archive?.skins.filter((skin) => skin.skinId === skinId);
    const key = `${normalized}-${skinId}`;
    assert(
      matches?.length === 1,
      `Skin absent from exact archive census: ${key}`,
    );
    if (nativeOpening === undefined)
      assert(!selected.has(key), `Duplicate skin selection: ${key}`);
    selected.set(key, [archive, matches[0]]);
  }
  await mkdir(out);
  const skins = [];
  for (const key of [...selected.keys()].sort()) {
    const [archive, skin] = selected.get(key);
    const { champion } = archive;
    const { skinId } = skin;
    assert.match(archive.archiveIndexSha256, /^[a-f0-9]{64}$/);
    skins.push({
      champion,
      skinId,
      archiveIndexSha256: archive.archiveIndexSha256,
      ...(await exportSkin(champion, skinId, archive, skin)),
    });
  }
  const manifest = JSON.stringify(
    {
      schema: 1,
      kind: "exact-native-terrain-skin-inputs",
      build,
      protocol,
      installedExeSha256: executableHash,
      sourceCensusSha256: censusSha256,
      selectionSha256,
      ...(build === currentChampionBuild && buildScoped
        ? { selectionKind: "archive" }
        : {}),
      ...(nativeOpening === undefined ? {} : { nativeOpening }),
      scope:
        "Private archived model inputs. Match legality, conversion and model admission are separate.",
      skins,
    },
    null,
    2,
  );
  await writeFile(join(out, "manifest.json"), manifest, { flag: "wx" });
  console.log(
    JSON.stringify({ skins: skins.length, manifestSha256: hash(manifest) }),
  );
}

async function writeArchiveCensus(build, installedExeSha256) {
  await requireCanonicalPrivateOutput();
  const archiveDirectory = "DATA/FINAL/Champions";
  const archiveFiles = (
    await readdir(join(installation, "Game", archiveDirectory))
  )
    .filter((file) => /^[a-z0-9_]+\.wad\.client$/i.test(file))
    .sort();
  const archiveRoots = [];
  let typedSkins = 0;
  let directTextures = 0;
  let materialOverrides = 0;
  let highestSkinId = 0;
  const maxSkinId = 10000;
  const skinClass = mapBinHash("SkinCharacterDataProperties");
  const validReference = (node) =>
    (node?.type === "String" &&
      typeof node.value === "string" &&
      node.value.length > 0) ||
    (node?.type === "WadChunkLink" && !/^0+$/.test(node.value));
  for (const file of archiveFiles) {
    const champion = file.slice(0, -".wad.client".length);
    const archive = archiveDirectory + "/" + file;
    const stem = `data/characters/${champion.toLowerCase()}/skins/skin`;
    const read = await openLocalWad(
      installation,
      archive,
      Bun.zstdDecompressSync,
    );
    if (!read.has(stem + "0.bin"))
      throw Error(`Missing canonical Skin0 chunk in ${archive}`);
    const index = await readArchiveIndex(archive);
    const skins = [];
    for (let skinId = 0; skinId <= maxSkinId; skinId++) {
      const path = stem + skinId + ".bin";
      if (!read.has(path)) continue;
      const bytes = await read(path);
      const rootPathHash = mapBinHash(
        `Characters/${champion}/Skins/Skin${skinId}`,
      );
      const roots = readExactMapBin(bytes).objects.filter(
        ({ pathHash, classHash }) =>
          pathHash === rootPathHash && classHash === skinClass,
      );
      if (roots.length !== 1)
        throw Error(`Missing unique typed skin root in ${path}`);
      const properties = field(roots[0], "skinMeshProperties");
      const simpleSkin = field(properties, "simpleSkin");
      const skeleton = field(properties, "skeleton");
      const texture = field(properties, "texture");
      if (
        [simpleSkin, skeleton].some(
          (node) =>
            !validReference(node) ||
            (node.type === "String" && !read.has(node.value)),
        )
      )
        throw Error(`Missing mesh or rig reference in ${path}`);
      const overrideCount =
        field(properties, "materialOverride")?.elements?.length ?? 0;
      typedSkins++;
      if (validReference(texture)) directTextures++;
      if (overrideCount > 0) materialOverrides++;
      highestSkinId = Math.max(highestSkinId, skinId);
      skins.push({
        skinId,
        rootPathHash,
        sourceSha256: hash(bytes),
        simpleSkin,
        skeleton,
        texture: texture ?? null,
        materialOverrideCount: overrideCount,
      });
    }
    archiveRoots.push({
      champion,
      archive,
      ...index,
      skins,
    });
  }
  if (!archiveRoots.length) throw Error("No canonical local champion archives");
  const coverage = {
    championArchives: archiveRoots.length,
    typedSkins,
    directTextures,
    materialOverrides,
    highestSkinId,
    maxSkinIdSearched: maxSkinId,
  };
  const manifest = JSON.stringify(
    {
      schema: 1,
      kind: "exact-native-terrain-archived-skin-census",
      build,
      protocol,
      installedExeSha256,
      coverage,
      scope:
        "Typed archived candidates. Match legality, complete linked asset bytes, and model conversion are separate.",
      archiveRoots,
    },
    null,
    2,
  );
  await mkdir(out);
  await writeFile(join(out, "manifest.json"), manifest, { flag: "wx" });
  console.log(JSON.stringify({ ...coverage, manifestSha256: hash(manifest) }));
}
