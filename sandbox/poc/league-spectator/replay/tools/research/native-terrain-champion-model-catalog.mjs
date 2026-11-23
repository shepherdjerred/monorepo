import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createNativeTerrainChampionCreation88Reader } from "./native-terrain-champion-identities.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const digestPattern = /^[a-f0-9]{64}$/;

export function readChampionModelSelections(prepared, codecs) {
  const { observations, packetReader } = prepared;
  const readCreation = createNativeTerrainChampionCreation88Reader(
    observations,
    codecs,
  );
  const { keyframe, packets } = packetReader.read(0);
  assert.equal(keyframe.timeSeconds, 0);
  let opcode = null;
  let context = 0;
  const creations = [];
  for (const packet of packets) {
    if (packet.stream !== 2 || packet.chunkOffset !== keyframe.chunkOffset)
      break;
    opcode = packet.explicitOpcode ?? opcode;
    context =
      packet.marker & 32
        ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
        : packet.paramBits;
    if (opcode !== 88) continue;
    assert.equal(context, 0, "Unexpected opcode 88 envelope context");
    creations.push(readCreation(packet.payload, { includeSkin: true }));
  }
  return corroborateChampionModelSelections(observations, creations);
}

export function corroborateChampionModelSelections(observations, creations) {
  const { binding, roster } = observations;
  assert.equal(roster.length, 10, "Expected a complete 5v5 footer");
  assert.equal(binding.unresolved.length, 0, "Roster contexts are unresolved");
  assert.equal(binding.verified.length, roster.length);
  assert.equal(
    creations.length,
    roster.length,
    "Expected one creation per participant",
  );
  const footerRows = new Map(
    binding.verified.map(({ context, footerRow }) => [context, footerRow]),
  );
  assert.equal(footerRows.size, roster.length, "Duplicate bound context");
  assert.equal(
    new Set(footerRows.values()).size,
    roster.length,
    "Duplicate footer row",
  );
  const contexts = new Set();
  return creations.map(({ context, champion, skinId }) => {
    assert.ok(!contexts.has(context), "Duplicate opening creation context");
    contexts.add(context);
    const footerRow = footerRows.get(context);
    assert.ok(
      Number.isInteger(footerRow) &&
        footerRow >= 1 &&
        footerRow <= roster.length,
    );
    assert.equal(
      champion,
      roster[footerRow - 1].champion,
      "Opening creation champion disagrees with its footer row",
    );
    assert.match(champion, /^[a-z0-9_]+$/i);
    assert.ok(Number.isSafeInteger(skinId) && skinId >= 0 && skinId <= 10000);
    return { context, champion, skinId };
  });
}

async function readCatalogFile(root, file) {
  const target = join(root, file);
  assert.ok(
    (await lstat(target)).isFile() && (await realpath(target)) === target,
    "Champion catalog requires exact regular files",
  );
  return await readFile(target);
}

export async function loadChampionModelCatalog(
  manifestPath,
  expectedSha256,
  identity,
  selections,
) {
  assert.match(expectedSha256, digestPattern);
  const root = await realpath(dirname(manifestPath));
  const manifestBytes = await readCatalogFile(root, basename(manifestPath));
  assert.equal(
    sha256(manifestBytes),
    expectedSha256,
    "Champion catalog digest differs",
  );
  const catalog = JSON.parse(manifestBytes.toString("utf8"));
  assert.equal(catalog.schema, 1);
  assert.equal(catalog.kind, "exact-native-terrain-champion-catalog");
  assert.equal(catalog.build, identity.build, "Champion catalog build differs");
  assert.equal(
    catalog.protocol,
    identity.protocol,
    "Champion catalog protocol differs",
  );
  assert.ok(!Object.hasOwn(catalog, "replaySha256"));
  assert.ok(
    catalog.assets &&
      !Array.isArray(catalog.assets) &&
      typeof catalog.assets === "object",
  );
  const routes = new Map();
  const bindings = [];
  for (const { context, champion, skinId } of selections) {
    const key = `${champion.toLowerCase()}-${skinId}`;
    assert.ok(
      Object.hasOwn(catalog.assets, key),
      `Missing exact champion skin: ${key}`,
    );
    const asset = catalog.assets[key];
    assert.equal(asset.champion, champion);
    assert.equal(asset.skinId, skinId);
    const { skinScale, hiddenRanges, model } = asset;
    assert.ok(
      skinScale === null || (Number.isFinite(skinScale) && skinScale > 0),
    );
    assert.ok(
      Array.isArray(hiddenRanges) &&
        hiddenRanges.every(
          (name) => typeof name === "string" && name.length > 0,
        ),
    );
    assert.equal(new Set(hiddenRanges).size, hiddenRanges.length);
    assert.equal(model.file, `${key}/model.glb`);
    assert.match(model.sha256, digestPattern);
    const bytes = await readCatalogFile(root, model.file);
    assert.equal(bytes.byteLength, model.bytes);
    assert.equal(sha256(bytes), model.sha256, "Champion model digest differs");
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "glTF");
    assert.equal(bytes.readUInt32LE(4), 2);
    assert.equal(bytes.readUInt32LE(8), bytes.byteLength);
    const url = `/champion-models/${model.sha256}.glb`;
    routes.set(url, [bytes, "model/gltf-binary"]);
    bindings.push({
      participantId: context,
      skinId,
      skinScale: skinScale ?? 1,
      hiddenRanges,
      url,
    });
  }
  return { bindings, routes };
}
