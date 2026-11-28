import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { zstdDecompressSync } from "node:zlib";
import { createReplayPacketReader } from "../../../../../../packages/scout-for-lol/packages/replay/src/packets.ts";
import {
  readExactMapBin,
  readExactMayhemMapDefinition,
} from "../exact-map-bin.mjs";
import { mapBinHash } from "../map-scene-assets.mjs";
import {
  mayhemLaneMapSha256,
  mayhemLaneMaterialsSha256,
} from "./mayhem-lane-minion-catalog.mjs";
import {
  currentTerrainPositionBuild,
  terrainPositionProtocol,
} from "./native-terrain-byte-codecs.mjs";

const bloomReplaySha256 =
  "4bb0f94d3ceb19df374c0937a9e59dcc866a5b92e4727b81c6c7d5b3aca970b7";
const skins = new Map([
  ["Characters/Turret/Skins/Skin44", ["Turret", 4]],
  ["Characters/Turret/Skins/Skin45", ["Turret", 4]],
  ["Characters/Turret/Skins/Skin31", ["HA_AP_ChaosTurretShrine", 1]],
  [
    "Characters/HA_AP_OrderShrineTurret/Skins/Skin1",
    ["HA_AP_OrderShrineTurret", 1],
  ],
  ["Characters/Nexus/Skins/Skin36", ["Nexus", 1]],
  ["Characters/Nexus/Skins/Skin37", ["Nexus", 1]],
  ["Characters/Inhibitor/Skins/Skin34", ["Inhibitor", 1]],
  ["Characters/Inhibitor/Skins/Skin35", ["Inhibitor", 1]],
]);
const field = (node, key) => node.fields[mapBinHash(key)];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function readAuthoredStructures(materialBytes, mapBytes) {
  const materials = readExactMapBin(materialBytes);
  const map = readExactMayhemMapDefinition(mapBytes);
  assert.equal(materials.sourceSha256, mayhemLaneMaterialsSha256);
  assert.equal(map.sourceSha256, mayhemLaneMapSha256);
  const bloom = map.objects.find(
    ({ pathHash }) =>
      pathHash === mapBinHash("Maps/Shipping/Map12/MapSkins/Bloom"),
  );
  assert.equal(bloom?.classHash, mapBinHash("MapSkin"));
  const nodes = new Map(materials.objects.map((node) => [node.pathHash, node]));
  const container = nodes.get(
    mapBinHash(field(bloom, "mMapContainerLink").value),
  );
  assert.equal(container?.classHash, mapBinHash("MapContainer"));
  const rows = new Map();
  const counts = new Map();
  for (const { value } of field(container, "chunks").entries) {
    const chunk = nodes.get(value.value.toString(16).padStart(8, "0"));
    assert.equal(chunk?.classHash, mapBinHash("MapPlaceableContainer"));
    for (const { value: item } of field(chunk, "items")?.entries ?? []) {
      const character = field(item, "Character");
      if (character === undefined) continue;
      const skin = field(character, "Skin")?.value;
      const asset = skins.get(skin);
      if (asset === undefined) continue;
      const name = field(item, "Name");
      const transform = field(item, "transform");
      const record = field(character, "CharacterRecord").value;
      assert.equal(item.classHash, "ad65d8c4");
      assert.equal(name.type, "Hash");
      assert.ok(!rows.has(name.value), "Duplicate authored structure name");
      assert.equal(transform.type, "Matrix44");
      assert.equal(transform.value.length, 16);
      assert.ok(transform.value.every(Number.isFinite));
      assert.ok(record.startsWith(`Characters/${asset[0]}/CharacterRecords/`));
      rows.set(name.value, {
        mapNameHash: name.value,
        record,
        skin,
        transform: transform.value,
      });
      counts.set(skin, (counts.get(skin) ?? 0) + 1);
    }
  }
  for (const [skin, [, count]] of skins)
    assert.equal(counts.get(skin), count, skin);
  return [...rows.values()];
}

function readOpeningPackets(replayBytes) {
  const reader = createReplayPacketReader(
    new Uint8Array(replayBytes).buffer,
    (input, target) =>
      zstdDecompressSync(input, { maxOutputLength: target.byteLength }),
  );
  assert.equal(reader.build, currentTerrainPositionBuild);
  assert.equal(reader.protocol, terrainPositionProtocol);
  assert.equal(hash(replayBytes), bloomReplaySha256);
  const { keyframe, packets } = reader.read(0);
  assert.equal(keyframe.timeSeconds, 0);
  const markers = new Map();
  const names = new Map();
  let opcode;
  let context = 0;
  for (const packet of packets) {
    if (packet.stream !== 2 || packet.chunkOffset !== keyframe.chunkOffset)
      continue;
    opcode = packet.explicitOpcode ?? opcode;
    context =
      packet.marker & 32
        ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
        : packet.paramBits;
    if (opcode === 1012 && packet.payload.length === 41) {
      assert.ok(!markers.has(context), "Duplicate opening structure marker");
      markers.set(context, Buffer.from(packet.payload).toString("hex"));
    }
    if (opcode === 921) {
      const rows = names.get(context) ?? [];
      rows.push(Buffer.from(packet.payload).toString("hex"));
      names.set(context, rows);
    }
  }
  assert.equal(markers.size, 10);
  return [...markers].map(([context, markerPayload]) => {
    const rows = names.get(context);
    assert.equal(rows?.length, 1, `Opening name count at context ${context}`);
    return { context, markerPayload, namePayload: rows[0] };
  });
}

const [replayPath, materialsPath, mapPath, ...extra] = process.argv.slice(2);
assert.ok(
  mapPath && extra.length === 0,
  "Usage: bun audit-mayhem-bloom-structures.mjs <Bloom replay> <Bloom materials.bin> <Map12 bin>",
);
const [replayBytes, materialBytes, mapBytes] = await Promise.all(
  [replayPath, materialsPath, mapPath].map((path) => readFile(path)),
);
console.log(
  JSON.stringify(
    {
      kind: "mayhem-bloom-structure-census",
      replaySha256: bloomReplaySha256,
      materialsSha256: mayhemLaneMaterialsSha256,
      mapSha256: mayhemLaneMapSha256,
      authoredStructures: readAuthoredStructures(materialBytes, mapBytes),
      openingPackets: readOpeningPackets(replayBytes),
      bindings: "unverified",
    },
    null,
    2,
  ),
);
