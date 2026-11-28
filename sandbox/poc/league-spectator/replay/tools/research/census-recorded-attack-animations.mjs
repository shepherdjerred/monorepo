import assert from "node:assert/strict";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { openReplay } from "../../transport.mjs";
import { readExactMapBin } from "../exact-map-bin.mjs";
import { mapBinHash } from "../map-scene-assets.mjs";
import { auditChampionAnimation } from "../verify-native-terrain-champion-animation.mjs";
import { openLocalWad } from "../wad.mjs";
import {
  currentTerrainClientArchiveSha256,
  currentTerrainPositionBuild,
  terrainPositionProtocol,
} from "./native-terrain-byte-codecs.mjs";

const [
  installation,
  replayPath,
  manifestPath,
  manifestSha256,
  output,
  ...proofArgs
] = process.argv.slice(2);
const defaultArgs =
  proofArgs[0] === "--attack-defaults" ? proofArgs.slice(0, 3) : [];
const spellDefaultArgs = proofArgs.slice(defaultArgs.length);
if (
  !output ||
  (defaultArgs.length > 0 && defaultArgs.length !== 3) ||
  (spellDefaultArgs.length > 0 &&
    (spellDefaultArgs.length !== 2 ||
      spellDefaultArgs[0] !== "--spell-animation-default"))
)
  throw new Error(
    "Usage: bun census-recorded-attack-animations.mjs <exact installation> <original ROFL> <champion source manifest> <manifest sha256> <fresh private .cache receipt> [--attack-defaults <receipt> <sha256>] [--spell-animation-default <exact macOS archive>]",
  );

const sha256 = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const field = (object, key) => object?.fields?.[mapBinHash(key)];
const value = (property) =>
  property?.type === "Optional" ? property.value : property;

const cache = await realpath(".cache");
const parent = await realpath(dirname(resolve(output)));
assert.ok(parent === cache || parent.startsWith(cache + sep));
const manifestBytes = await readFile(manifestPath);
assert.equal(sha256(manifestBytes), manifestSha256);
const manifest = JSON.parse(manifestBytes);
const replayBytes = new Uint8Array(await Bun.file(replayPath).arrayBuffer());
const replay = openReplay(replayBytes.buffer);
assert.equal(replay.build, currentTerrainPositionBuild);
assert.equal(replay.protocol, terrainPositionProtocol);
assert.equal(manifest.build, replay.build);
assert.equal(manifest.protocol, replay.protocol);
assert.equal(manifest.nativeOpening.replaySha256, sha256(replayBytes));

const [, defaultPath, attackDefaultsSha256] = defaultArgs;
let attackDefaults;
if (defaultPath !== undefined) {
  const bytes = await readFile(defaultPath);
  assert.equal(sha256(bytes), attackDefaultsSha256);
  const proof = JSON.parse(bytes);
  assert.equal(proof.schema, 1);
  assert.equal(proof.kind, "current-native-default-attack-names");
  assert.equal(proof.build, replay.build);
  assert.equal(proof.archiveSha256, currentTerrainClientArchiveSha256);
  assert.equal(Object.keys(proof.defaults).length, 18);
  attackDefaults = proof.defaults;
  for (let slot = 64; slot <= 81; slot++) {
    const { format, number } = attackDefaults[slot];
    assert.match(format, /^%s(?:Basic|Crit)Attack(?:%i)?$/u);
    assert.ok(
      format.endsWith("%i") ? Number.isInteger(number) : number === null,
    );
  }
}

const [, spellDefaultPath] = spellDefaultArgs;
let spellAnimationDefault;
if (spellDefaultPath !== undefined) {
  const archive = await readFile(spellDefaultPath);
  const archiveSha256 = sha256(archive);
  assert.equal(archiveSha256, currentTerrainClientArchiveSha256);
  // SpellDataResource registration -> factory -> constructor. The separate
  // property registration and initializer both target the string at +0x240.
  const nativeSpans = [
    [
      0x8b920b,
      "488d159e5e0000488d0dd75e00004c8d05f05e00004c8d0df95e0000be69853643e8dfbfc200",
    ],
    [
      0x8bf0b0,
      "554889e5415653bf48080000e83f52be004889c34889c7e87459ffff4889d85b415e5dc3",
    ],
    [0x8b4e9c, "4889dfe8ec030000"],
    [0x8b5290, "554889e54157415653504889fb"],
    [0x8b9432, "4889dfbeb56fd1fbba4002000031c94531c0e8d7877bff"],
    [0x8b5300, "488dbb40020000488d35590d9a01e8cdc5c300"],
  ];
  for (const [offset, hex] of nativeSpans)
    assert.equal(
      archive.subarray(offset, offset + hex.length / 2).toString("hex"),
      hex,
    );
  const literalOffset = archive.readInt32LE(0x8b530a) + 0x8b530e;
  assert.equal(literalOffset, 0x2256067);
  assert.equal(
    archive.toString("ascii", literalOffset, literalOffset + 8),
    "Attack1\0",
  );
  spellAnimationDefault = {
    archiveSha256,
    classRegistrationFileOffset: 0x8b920b,
    propertyRegistrationFileOffset: 0x8b9432,
    factoryFileOffset: 0x8bf0b0,
    constructorFileOffset: 0x8b4a40,
    fieldDefaultsFileOffset: 0x8b5290,
    initializerFileOffset: 0x8b5300,
    literalFileOffset: literalOffset,
    animationName: archive.toString("ascii", literalOffset, literalOffset + 7),
  };
}

// Run the shared source/skin/executable audit before opening CharacterRecords.
await auditChampionAnimation(installation, manifestPath, replayBytes, [], {
  allowCurrentBuild: true,
});

async function readAttackRecords({ champion, context, skinId }) {
  const skin = manifest.skins.find(
    (row) => row.champion === champion && row.skinId === skinId,
  );
  assert.ok(skin);
  const wad = await openLocalWad(
    installation,
    skin.archive,
    Bun.zstdDecompressSync,
  );
  const skeleton = skin.resources.skeleton;
  const { type, value: reference } = skeleton.reference;
  assert.ok(type === "String" || type === "WadChunkLink");
  const rig =
    type === "String"
      ? await wad(reference)
      : await wad.byHash(BigInt(reference));
  assert.equal(rig.length, skeleton.bytes);
  assert.equal(sha256(rig), skeleton.sha256);

  const folder = champion.toLowerCase();
  const path = `data/characters/${folder}/${folder}.bin`;
  const bin = readExactMapBin(await wad(path));
  const roots = bin.objects.filter(
    (row) =>
      row.pathHash ===
      mapBinHash(`Characters/${champion}/CharacterRecords/Root`),
  );
  assert.equal(roots.length, 1);
  const [root] = roots;
  assert.equal(root.classHash, mapBinHash("CharacterRecord"));
  const characterName = value(field(root, "mCharacterName"));

  const spells = bin.objects.filter(
    (row) => row.classHash === mapBinHash("SpellObject"),
  );
  const attacks = [];
  for (const [category, firstSlot, records] of [
    ["basic", 64, [field(root, "basicAttack")]],
    ["extra", 65, field(root, "extraAttacks")?.elements ?? []],
    ["critical", 73, field(root, "critAttacks")?.elements ?? []],
  ]) {
    for (const [index, record] of records.entries()) {
      const name = value(field(record, "mAttackName"));
      const explicit = name != null;
      let spellName;
      if (explicit) {
        assert.equal(name.type, "String");
        spellName = name.value;
        if (spellName === "") {
          attacks.push({ category, index, status: "attack-name-empty" });
          continue;
        }
      } else if (attackDefaults !== undefined) {
        assert.equal(characterName?.type, "String");
        const { format, number } = attackDefaults[firstSlot + index];
        spellName = format
          .replace("%s", characterName.value)
          .replace("%i", String(number));
      } else {
        attacks.push({
          category,
          index,
          status: "attack-name-default-unverified",
        });
        continue;
      }
      const matches = spells.filter(
        (row) =>
          (
            field(row, "ObjectName") ?? field(row, "mScriptName")
          )?.value?.toLowerCase() === spellName.toLowerCase(),
      );
      assert.ok(matches.length <= 1, "Ambiguous archived attack SpellObject");
      const spell = matches[0];
      const spellData = field(spell, "mSpell");
      const authoredAnimation = field(spellData, "mAnimationName");
      const animation = value(authoredAnimation);
      const constructorDefault =
        spellData !== undefined &&
        authoredAnimation === undefined &&
        spellAnimationDefault !== undefined;
      const animationName = constructorDefault
        ? spellAnimationDefault.animationName
        : animation?.value;
      const selection = {
        category,
        index,
        spellName,
        ...(explicit ? {} : { nameSource: "original-native-formatter" }),
      };
      if (spell === undefined || !animationName) {
        attacks.push({
          ...selection,
          status:
            spell === undefined
              ? "spell-object-missing"
              : "animation-name-unavailable",
        });
        continue;
      }
      if (!constructorDefault) assert.equal(animation.type, "String");
      attacks.push({
        ...selection,
        spellPathHash: spell.pathHash,
        animationName,
        ...(constructorDefault
          ? { animationNameSource: "original-constructor" }
          : {}),
      });
    }
  }
  return {
    champion,
    context,
    skinId,
    characterBin: { path, sha256: bin.sourceSha256 },
    rig: { bytes: rig.length, sha256: skeleton.sha256 },
    attacks,
  };
}

const records = [];
for (const selected of manifest.nativeOpening.rows)
  records.push(await readAttackRecords(selected));
const animationNames = [
  ...new Set(
    records.flatMap(({ attacks }) =>
      attacks.flatMap(({ animationName }) =>
        animationName === undefined ? [] : [animationName],
      ),
    ),
  ),
].sort();
const graphs = await auditChampionAnimation(
  installation,
  manifestPath,
  replayBytes,
  animationNames,
  { allowCurrentBuild: true },
);
const statusCounts = {};
const actors = records.map((record, index) => {
  const graph = graphs.actors[index];
  assert.equal(graph.context, record.context);
  const attacks = record.attacks.map((attack) => {
    const clip = graph.probes[attack.animationName];
    const status =
      attack.status ??
      (clip === undefined
        ? "graph-key-missing"
        : clip.classHash === mapBinHash("AtomicClipData")
          ? "atomic-asset"
          : "graph-selection-unverified");
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    return { ...attack, status, ...(clip === undefined ? {} : { clip }) };
  });
  return { ...record, animationGraph: graph.animationGraph, attacks };
});
const receipt = {
  schema: 1,
  kind: "recorded-attack-animation-census",
  build: replay.build,
  protocol: replay.protocol,
  replaySha256: manifest.nativeOpening.replaySha256,
  executableSha256: graphs.executableSha256,
  sourceManifestSha256: manifestSha256,
  ...(attackDefaultsSha256 === undefined ? {} : { attackDefaultsSha256 }),
  ...(spellAnimationDefault === undefined ? {} : { spellAnimationDefault }),
  scope:
    "Authored CharacterRecord indices, explicit animation names, and original graph/rig assets. Attack packet slot mapping, graph selectors, and playback timing are outside this census.",
  statusCounts,
  actors,
};
const source = JSON.stringify(receipt, null, 2) + "\n";
await writeFile(join(parent, basename(output)), source, { flag: "wx" });
console.log(
  JSON.stringify({
    sha256: sha256(source),
    actors: actors.length,
    statusCounts,
  }),
);
