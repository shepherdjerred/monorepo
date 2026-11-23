// Local research only. Hash and compare numeric placeable records in memory.
import { resolve } from "node:path";
import { readExactMapBin } from "./exact-map-bin.mjs";
import {
  mapBinHash,
  MAP11_RELEASE_SHA256,
  MAP11_RESEARCH_BUILD,
} from "./map-scene-assets.mjs";
import { readMap11PlaceableInventory } from "./map11-world-catalog.mjs";
import { openLocalWad } from "./wad.mjs";

const wadPath = "DATA/FINAL/Maps/Shipping/Map11.wad.client";
const entryPath = "data/maps/mapgeometry/map11/base_srx.materials.bin";
const sha256 = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

export function readKeyedPlaceableSpan(bytes, keyHash, record) {
  const spans = record?.fieldSpans;
  if (!Array.isArray(spans) || !spans.length || record.type !== "Struct")
    throw Error("Expected a complete typed placeable struct");
  // The map entry's hash key, class, byte length and field count precede its fields.
  const start = spans[0].offset - 14;
  const end = spans.at(-1).offset + spans.at(-1).bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    start < 0 ||
    end <= start + 14 ||
    end > bytes.length ||
    view.getUint32(start, true) !== keyHash ||
    view
      .getUint32(start + 4, true)
      .toString(16)
      .padStart(8, "0") !== record.classHash ||
    view.getUint32(start + 8, true) !== end - start - 12 ||
    view.getUint16(start + 12, true) !== spans.length
  )
    throw Error(
      "Archived placeable byte range disagrees with its typed record",
    );
  return { offset: start, bytes: bytes.subarray(start, end) };
}

export function uniqueInstalledOffset(installed, record) {
  if (!record.length) throw Error("Expected nonempty archived placeable bytes");
  const offset = installed.indexOf(record);
  if (offset < 0)
    throw Error("Archived placeable does not occur in the installed metadata");
  if (installed.indexOf(record, offset + 1) !== -1)
    throw Error(
      "Archived placeable occurs more than once in the installed metadata",
    );
  return offset;
}

async function main(sourceDir, installation) {
  const manifest = await Bun.file(
    resolve(sourceDir, "world-source-manifest.json"),
  ).json();
  if (
    manifest.kind !== "archived-map11-world-source" ||
    manifest.build !== MAP11_RESEARCH_BUILD ||
    manifest.protocol !== "20e09df23c66b85e" ||
    manifest.releaseManifestSha256 !== MAP11_RELEASE_SHA256 ||
    manifest.releaseManifestId !== "B499FB04B1158CF6"
  )
    throw Error("Expected the admitted archived Map11 source manifest");
  const old = Buffer.from(
    await Bun.file(resolve(sourceDir, "materials.bin")).arrayBuffer(),
  );
  const archivedSha256 = sha256(old);
  const source = manifest.sources.find(({ path }) => path === entryPath);
  if (source?.bytes !== old.length || source.sha256 !== archivedSha256)
    throw Error("Archived Map11 materials do not match their source receipt");

  const tree = readExactMapBin(old, manifest.build, {
    captureFieldSpans: true,
  });
  const container = tree.objects.filter(
    ({ classHash }) => classHash === mapBinHash("MapContainer"),
  );
  if (container.length !== 1)
    throw Error("Expected one archived Map11 container");
  const inventory = readMap11PlaceableInventory(tree, container[0].pathHash);
  const placeables = inventory.registration.filter(
    ({ attackableType }) => attackableType === 0,
  );
  if (placeables.length !== 24)
    throw Error("Expected 24 archived Map11 type-0 attackable placeables");
  const chunks = new Map(
    tree.objects.map((object) => [object.pathHash, object]),
  );
  const versionFile = Bun.file(
    resolve(installation, "Game", "compat-version-metadata.json"),
  );
  const { version: installedCompatibilityVersion } = await versionFile.json();
  if (
    typeof installedCompatibilityVersion !== "string" ||
    !installedCompatibilityVersion
  )
    throw Error("Expected a version in the installed compatibility metadata");
  const read = await openLocalWad(installation, wadPath, (bytes) =>
    Bun.zstdDecompressSync(bytes),
  );
  const installed = Buffer.from(await read(entryPath));
  const records = placeables.map(
    ({ keyHash, mapNameHash, sourceChunk, transform, explicitTeam }) => {
      const chunk = chunks.get(sourceChunk.slice(1, -1));
      const entry = chunk.fields[mapBinHash("items")].entries.find(
        ({ key }) => key.value === keyHash,
      );
      const archived = readKeyedPlaceableSpan(old, keyHash, entry?.value);
      return {
        keyHash,
        mapNameHash,
        explicitTeam,
        translation: transform[3].slice(0, 3),
        archivedOffset: archived.offset,
        installedOffset: uniqueInstalledOffset(installed, archived.bytes),
        bytes: archived.bytes.length,
        sha256: sha256(archived.bytes),
      };
    },
  );
  if (
    new Set(records.map(({ installedOffset }) => installedOffset)).size !==
    records.length
  )
    throw Error("Installed placeables share a record offset");
  if ((await versionFile.json()).version !== installedCompatibilityVersion)
    throw Error("Installed version changed during the comparison");
  console.log(
    JSON.stringify(
      {
        archivedBuild: manifest.build,
        archivedSha256,
        installedCompatibilityVersion,
        installedSha256: sha256(installed),
        entryPath,
        attackableType: 0,
        uniqueMatches: records.length,
        records,
      },
      null,
      2,
    ),
  );
}

if (import.meta.main) {
  const [sourceDir, installation, ...extra] = process.argv.slice(2);
  if (!sourceDir || !installation || extra.length)
    throw Error(
      "Usage: bun verify-installed-map11-placements.mjs <archived-world-source-dir> <league-installation>",
    );
  await main(sourceDir, installation);
}
