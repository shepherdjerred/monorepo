import { mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { readExactItemDefinitions } from "../exact-map-bin.mjs";
import { openLocalWad } from "../wad.mjs";
import {
  championArchiveExecutableHashes,
  currentChampionBuild,
} from "./native-terrain-champion-model-catalog.mjs";

const sha256 = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const localeHash = 0x062d6ed714bff7dfn;
const localeSha256 =
  "9c252740f26c6825e446e42cd93f4be6afc90be89005e140c6c3161f5109046b";
const nameHashBits = 38n;
const nameHashMask = (1n << nameHashBits) - 1n;
const pngSignature = Buffer.from("89504e470d0a1a0a", "hex");
export const currentInventoryAssetSource = Object.freeze({
  installedExeSha256: championArchiveExecutableHashes[currentChampionBuild],
  archiveIndexSha256: Object.freeze({
    global: "df830d29218ffd1df26bf50af2be5df16b19d4e2aed9e7f629e9e349010d0b0c",
    localized:
      "09070c98d71ba5059bee206d814eb11b113dfc08cabc270beb35ff0302307939",
  }),
});

export function inventoryIconDimensions(bytes) {
  const png = Buffer.from(bytes);
  if (
    png.length < 33 ||
    png.length > 1_100_000 ||
    !png.subarray(0, 8).equals(pngSignature) ||
    png.readUInt32BE(8) !== 13 ||
    png.toString("ascii", 12, 16) !== "IHDR"
  )
    throw Error("Invalid archived item icon PNG");
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (!width || !height || width > 512 || height > 512)
    throw Error("Archived item icon dimensions exceed package bounds");
  return { width, height };
}

function readItemNames(raw, keys) {
  const bytes = Buffer.from(raw);
  if (
    sha256(bytes) !== localeSha256 ||
    !bytes.subarray(0, 4).equals(Buffer.from("52535405", "hex"))
  ) {
    throw Error("Wrong archived item string table");
  }
  const count = bytes.readUInt32LE(4);
  const stringsAt = 8 + count * 8;
  if (stringsAt >= bytes.length) throw Error("Truncated item string table");
  const pending = new Map();
  for (const key of keys) {
    const hash = Bun.hash.xxHash3(key.toLowerCase()) & nameHashMask;
    if (pending.has(hash) && pending.get(hash) !== key)
      throw Error("Ambiguous item name key");
    pending.set(hash, key);
  }
  const names = new Map();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let i = 0; i < count; i++) {
    const entry = bytes.readBigUInt64LE(8 + i * 8);
    const key = pending.get(entry & nameHashMask);
    if (key === undefined) continue;
    const position = stringsAt + Number(entry >> nameHashBits);
    const end = bytes.indexOf(0, position);
    if (end <= position || end - position > 240)
      throw Error(`Invalid archived item name ${key}`);
    const name = decoder.decode(bytes.subarray(position, end));
    if (names.has(key) && names.get(key) !== name)
      throw Error(`Conflicting archived item name ${key}`);
    names.set(key, name);
  }
  if (names.size !== pending.size) throw Error("Missing archived item name");
  return names;
}

function exactItemDescriptor(objects, itemId) {
  const matches = objects.filter(
    ({ classHash, fields }) =>
      classHash === "244c26e6" &&
      fields["13bddc7b"]?.type === "U32" &&
      fields["13bddc7b"].value === itemId,
  );
  const fields = matches[0]?.fields;
  const ui = fields?.d92888a0;
  const name = fields?.["74d44065"];
  const icon = ui?.fields?.c68db52e;
  if (
    matches.length !== 1 ||
    ui?.classHash !== "851af275" ||
    name?.type !== "String" ||
    icon?.type !== "WadChunkLink"
  ) {
    throw Error(`Missing exact icon/name association for item ${itemId}`);
  }
  return { itemId, stringKey: name.value, sourceHash: BigInt(icon.value) };
}

async function prepare(
  installation,
  requested,
  output,
  exporter,
  currentBuild,
) {
  const itemIds = requested.toSorted((left, right) => left - right);
  if (
    itemIds.length === 0 ||
    itemIds.length > 4096 ||
    itemIds.some(
      (id, i) => !Number.isSafeInteger(id) || id <= 0 || id === itemIds[i - 1],
    )
  )
    throw Error("Unique positive replay inventory item IDs required");
  const source = currentBuild ? currentInventoryAssetSource : undefined;
  if (
    source !== undefined &&
    sha256(
      await Bun.file(
        join(installation, "Game", "League of Legends.exe"),
      ).bytes(),
    ) !== source.installedExeSha256
  )
    throw Error("Installed current inventory asset build differs from the pin");
  const [global, localized] = await Promise.all([
    openLocalWad(
      installation,
      "DATA/FINAL/Global.wad.client",
      zstdDecompressSync,
      source?.archiveIndexSha256.global,
    ),
    openLocalWad(
      installation,
      "DATA/FINAL/Localized/Global.en_US.wad.client",
      zstdDecompressSync,
      source?.archiveIndexSha256.localized,
    ),
  ]);
  const [definitions, strings] = await Promise.all([
    global.byHash(0x1d720f4f42640c18n),
    localized.byHash(localeHash),
  ]);
  // Current archive entries match the archived definition and locale bytes.
  const {
    build: definitionBuild,
    objects,
    sourceSha256,
  } = readExactItemDefinitions(definitions);
  const descriptors = itemIds.map((id) => exactItemDescriptor(objects, id));
  const names = readItemNames(
    strings,
    descriptors.map(({ stringKey }) => stringKey),
  );
  await mkdir(output);
  const sources = join(output, "textures");
  const display = join(output, "item-icons");
  await Promise.all([mkdir(sources), mkdir(display)]);
  const jobs = {};
  const texturesByItem = new Map();
  const items = [];
  for (const { itemId, stringKey, sourceHash } of descriptors) {
    const bytes = Buffer.from(await global.byHash(sourceHash));
    const format = bytes.subarray(0, 4).toString("ascii");
    if (format !== "DDS " && format !== "TEX\0")
      throw Error(`Unknown archived item texture ${itemId}`);
    const texture = join(
      sources,
      `${itemId}.${format === "DDS " ? "dds" : "tex"}`,
    );
    const icon = `item-icons/${itemId}.png`;
    await Bun.write(texture, bytes);
    jobs[texture] = join(output, icon);
    texturesByItem.set(itemId, texture);
    items.push({
      itemId,
      name: names.get(stringKey),
      icon,
      textureHash: sourceHash.toString(16).padStart(16, "0"),
      textureSha256: sha256(bytes),
    });
  }
  const jobPath = join(output, "textures.json");
  await Bun.write(jobPath, JSON.stringify(jobs));
  const child = Bun.spawnSync(["dotnet", exporter, jobPath], {
    stdout: "pipe",
    stderr: "inherit",
  });
  if (child.exitCode !== 0) throw Error("Item texture conversion failed");
  const results = JSON.parse(child.stdout.toString("utf8"));
  const mipLevels = Object.values(results);
  if (
    mipLevels.length !== items.length ||
    mipLevels.some(({ mipLevel }) => mipLevel !== 0)
  ) {
    throw Error("Item icons require the highest authored mip");
  }
  for (const item of items) {
    const png = Buffer.from(
      await Bun.file(join(output, item.icon)).arrayBuffer(),
    );
    const dimensions = inventoryIconDimensions(png);
    if (currentBuild) {
      const texture = texturesByItem.get(item.itemId);
      const result = results[texture];
      if (
        result?.width !== dimensions.width ||
        result.height !== dimensions.height ||
        sha256(await Bun.file(texture).bytes()) !== item.textureSha256
      )
        throw Error(
          `Current item texture or output dimensions changed for ${item.itemId}`,
        );
    }
    Object.assign(item, dimensions, {
      iconSha256: sha256(png),
    });
  }
  const manifest = {
    kind: "scout-exact-inventory-assets",
    build: currentBuild ? currentChampionBuild : definitionBuild,
    definitionsSha256: sourceSha256,
    localeSha256,
    ...source,
    items,
  };
  const data = JSON.stringify(manifest) + "\n";
  await Bun.write(join(output, "manifest.json"), data);
  console.log(
    JSON.stringify({ itemCount: items.length, manifestSha256: sha256(data) }),
  );
}

if (import.meta.main) {
  const [installation, idsPath, output, exporter, ...options] =
    process.argv.slice(2);
  const currentBuild = options.length === 1 && options[0] === "--current-build";
  if (
    !installation ||
    !idsPath ||
    !output ||
    !exporter ||
    (options.length && !currentBuild)
  ) {
    throw Error(
      "Usage: bun prepare-exact-inventory-assets.mjs <installation> <item-ids.json> <output-dir> <terrain-texture-mips.dll> [--current-build]",
    );
  }
  const requested = await Bun.file(idsPath).json();
  if (!Array.isArray(requested)) throw Error("Replay item ID list required");
  await prepare(
    installation,
    requested,
    resolve(output),
    resolve(exporter),
    currentBuild,
  );
}
