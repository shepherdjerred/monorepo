import assert from "node:assert/strict";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { readExactMapBin } from "./exact-map-bin.mjs";
import {
  bindMap11BarracksDefinitions,
  readMap11PlaceableInventory,
} from "./map11-world-catalog.mjs";
import { exportNativeTerrainStructureModels } from "./native-terrain-structure-model-export.mjs";
import { prepareExactTerrainDecoder } from "./research/native-terrain-positions-944.mjs";
import { openLocalWad } from "./wad.mjs";

const [
  installation,
  exporter,
  nativeDecoderPath,
  actorPath,
  actorDigest,
  outArg,
  ...extra
] = process.argv.slice(2);
assert.ok(
  actorDigest && outArg && extra.length === 0,
  "Usage: bun prepare-native-terrain-lane-minions.mjs <installation> <ordinal exporter bin directory> <archived macOS client> <recorded actor proof JSON> <actor proof SHA-256> <new private .cache directory>",
);
const output = resolve(outArg);
const parent = await realpath(dirname(output));
const cache = await realpath(".cache");
assert.ok(
  parent === cache || parent.startsWith(cache + sep),
  "Lane minion output must stay in private .cache",
);
const destination = join(parent, basename(output));

const archive = "DATA/FINAL/Maps/Shipping/Map11.wad.client";
const materialsSha256 =
  "ed38cba7aaa4390e8b2a2cfe778d5f1151152b9b97f2c90883c17b27b510d67a";
const archiveByBuild = new Map([
  [
    "16.23.840.6595",
    {
      installedExeSha256:
        "89d73a9e6d886c291f5b3cf42904e5e8b014148b56490d2b6c862ea96cc9f156",
      mapBinSha256:
        "338a12c915c8fc2c38a7d5ac9e4ae1e15a1a4ccd0115f2e4f6050e15497ca0f6",
    },
  ],
  [
    "16.23.841.8428",
    {
      installedExeSha256:
        "f0fd2b02e3bb69d4573629c0daca863cc010556a1dbdd28ef3ef24ef10b9b733",
      mapBinSha256:
        "bf4b0fdfe1070103cad2d5f1e36a637f7c0d11a565f841acdbe3738fac6fe69d",
      archiveIndexSha256:
        "bd7d3d901aa1c96eb7f4969fdafedf500f99f636b1653ea45233274ac34e8b92",
    },
  ],
]);
const skinDigests = new Map([
  [
    "sru_orderminionmelee",
    "4803a1df3bfad0d1a9d328ae1410bec2271031b8b894d956fa4c9f68987913f8",
  ],
  [
    "sru_orderminionranged",
    "daef66466defdec7df13709924a724c24e5df2e37cc4cc5766f331312aabc129",
  ],
  [
    "sru_chaosminionmelee",
    "e420dfb094b5d51385c94a1616c079c877530164c6a9748ef1bcfc2b5c405221",
  ],
  [
    "sru_chaosminionranged",
    "252d7727b14dbdba8059529258bdc3638938058243a5af1a19bad1866c398e4a",
  ],
  [
    "sru_orderminionsiege",
    "363ed42ac00e898f228de6d76eaaa098cc28332132afd76ecc6b5164259a6a39",
  ],
  [
    "sru_chaosminionsiege",
    "d7e8f5cd6703dad48337f206f5941bb84abe6471a1663f5333d6e3c55c0c58dd",
  ],
  [
    "sru_orderminionsuper",
    "2ea085291376089b97c57dccbcb5688d495eab5cc57a83300c8f0ec5aade66d2",
  ],
  [
    "sru_chaosminionsuper",
    "07ba2aa3e3791f9d3951998a8ba3069f1104ab4607e812a7e873cb1c1f5ec702",
  ],
]);
const actorSource = await readFile(actorPath);
assert.match(actorDigest, /^[a-f0-9]{64}$/);
assert.equal(sha(actorSource), actorDigest, "Lane actor proof digest mismatch");
const actorProof = JSON.parse(actorSource);
assert.equal(actorProof.kind, "exact-terrain-lane-minion-waypoint-evidence");
const { build } = actorProof;
const archiveIdentity = archiveByBuild.get(build);
assert.ok(archiveIdentity, "Lane actor proof uses an unreviewed game build");
const { installedExeSha256, mapBinSha256, archiveIndexSha256 } =
  archiveIdentity;
assert.equal(actorProof.materialsSha256, materialsSha256);
assert.equal(actorProof.mapBinSha256, mapBinSha256);
assert.equal(
  sha(
    await Bun.file(join(installation, "Game", "League of Legends.exe")).bytes(),
  ),
  installedExeSha256,
  "Installed game file differs from the reviewed exact build",
);
const wad = await openLocalWad(
  installation,
  archive,
  Bun.zstdDecompressSync,
  archiveIndexSha256,
);
const materials = readExactMapBin(
  await wad("data/maps/mapgeometry/map11/base_srx.materials.bin"),
);
const map = readExactMapBin(await wad("data/maps/shipping/map11/map11.bin"));
assert.equal(materials.sourceSha256, materialsSha256);
assert.equal(map.sourceSha256, mapBinSha256);
const nativeDecoder = await readFile(nativeDecoderPath);
assert.equal(sha(nativeDecoder), actorProof.nativeReaderSha256);
assert.equal(
  sha(
    prepareExactTerrainDecoder(nativeDecoder, actorProof, {
      allowCurrentBuild: build === "16.23.841.8428",
    }),
  ),
  actorProof.decoderSha256,
);
const { registration } = bindMap11BarracksDefinitions(
  readMap11PlaceableInventory(materials, "09e8f830"),
  map,
);
const barracks = registration.filter(({ kind }) => kind === "barracks");
assert.equal(barracks.length, 6);
const authored = new Set(
  barracks.flatMap(({ units }) =>
    Object.values(units).map(({ asset }) => asset),
  ),
);
assert.deepEqual(
  authored,
  new Set([...skinDigests.keys()].map((id) => id + "/0")),
);
const used = new Set(actorProof.instances.map(({ modelId }) => modelId));
const skins = [...skinDigests].filter(([modelId]) => used.has(modelId));
assert.ok(skins.length > 0 && skins.length === used.size);
for (const [character, digest] of skins)
  assert.equal(
    sha(await wad(`data/characters/${character}/skins/skin0.bin`)),
    digest,
    `Authored ${character} skin differs from the reviewed Map11 source`,
  );

const { assets, toolchain } = await exportNativeTerrainStructureModels({
  archive,
  destination,
  exporter,
  wad,
  skins: skins.map(([character]) => ({ character, skinId: 0 })),
  requireHiddenRanges: false,
});
const models = skins.map(([modelId, digest]) => {
  const asset = assets[modelId + "-0"];
  assert.equal(asset.inputs.skin.sha256, digest);
  return { modelId, ...asset };
});
await writeFile(
  join(destination, "manifest.json"),
  JSON.stringify({
    schema: 1,
    kind: "exact-native-terrain-lane-minion-assets",
    build,
    archive,
    ...(archiveIndexSha256 === undefined ? {} : { archiveIndexSha256 }),
    installedExeSha256,
    materialsSha256,
    mapBinSha256,
    toolchain,
    models,
    actorDigest,
    actorProof,
  }),
  { flag: "wx" },
);
