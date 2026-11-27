import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import {
  openReplay,
  replayPacketEnvelopes,
} from "../../../../../packages/scout-for-lol/packages/replay/src/observations/transport.mjs";
import { replayTimedPacketEnvelopes } from "../../../../../packages/scout-for-lol/packages/replay/src/observations/replay-packet-clock.mjs";
import { readExactMapBin } from "./exact-map-bin.mjs";
import { mapBinHash } from "./map-scene-assets.mjs";

const [replayPath, geometryMetadata, materialBin, output, mode] =
  process.argv.slice(2);
if (
  !replayPath ||
  !geometryMetadata ||
  !materialBin ||
  !output ||
  (mode !== undefined &&
    mode !== "--same-build" &&
    mode !== "--exact-8428" &&
    mode !== "--compare-8428-packets") ||
  process.argv.length > 7
)
  throw Error(
    "Usage: bun extract-exact-map11-controller-inputs.mjs <saved-rofl> <map.json> <base_srx.materials.bin> <new-input.json> [--same-build | --exact-8428 | --compare-8428-packets]",
  );
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const long = "cea604f9944cb8ca433a0655d742e0b741ae4477e0c7100b59a25b3221562668";
const short =
  "d7cabb0b7ba965f317863d128238847a0b9b0e4cc0cdbcfa3077c537b10fdf2b";
const comparePackets = mode === "--compare-8428-packets";
const bytes = readFileSync(replayPath);
const replaySha256 = sha(bytes);
if (mode === undefined) assert.ok([short, long].includes(replaySha256));
const replay = openReplay(Uint8Array.from(bytes).buffer);
assert.equal(
  replay.build,
  comparePackets || mode === "--exact-8428"
    ? "16.23.841.8428"
    : "16.23.840.6595",
);
assert.equal(replay.protocol, "8bbfcd5af2bc92db");
const map = readFileSync(geometryMetadata);
const geometrySha256 = sha(map);
const allowedExports = new Map([
  ["24716f3c47ed5eadaa80693f0113dffb21dd2b5ab419957c5ae91c3a0e77ad15", 12],
  ["4a8b2432fa3316647092fee062ff84c198f5e085ea11860aa4584082f46a889d", 13],
]);
assert.ok(allowedExports.has(geometrySha256));
const materials = readFileSync(materialBin);
const materialsSha256 = sha(materials);
assert.equal(
  materialsSha256,
  "ed38cba7aaa4390e8b2a2cfe778d5f1151152b9b97f2c90883c17b27b510d67a",
);
const meshControllerIds = [
  ...new Set(
    JSON.parse(map)
      .meshes.map((mesh) => mesh.controller)
      .filter(Boolean),
  ),
].sort((a, b) => a - b);
assert.equal(meshControllerIds.length, allowedExports.get(geometrySha256));

const directClasses = new Set(["c406a533", "ec733fe2", "e07edfa4"]);
const { objects } = readExactMapBin(materials);
const controllers = {};
for (const { pathHash, classHash, fields } of objects) {
  const id = Number.parseInt(pathHash, 16);
  if (directClasses.has(classHash)) {
    const name = fields[mapBinHash("Name")];
    assert.equal(name.type, "Hash");
    const authored = fields[mapBinHash("DefaultVisible")];
    assert.ok(authored === undefined || authored.type === "Bool");
    controllers[id] = {
      classHash,
      nameHash: name.value,
      defaultVisible: authored?.value ?? null,
      elementalTerrainFlags:
        fields[mapBinHash("ElementalTerrainFlags")]?.value ?? null,
    };
  } else if (classHash === "e21083b5") {
    const children = fields["3044938a"].elements.map((field) => {
      assert.equal(field.type, "ObjectLink");
      return field.value;
    });
    controllers[id] = {
      classHash,
      children,
      operation: fields["c9d3f06a"]?.value ?? null,
    };
  }
}
let opcode;
let context = 0;
const packets = [];
const snapshotChunks = new Set();
for (const packet of replayTimedPacketEnvelopes(
  replayPacketEnvelopes(replay, (input, out) =>
    zstdDecompressSync(input, { maxOutputLength: out.byteLength }),
  ),
)) {
  if (packet.blockOffset === 0) {
    opcode = undefined;
    context = 0;
    if (packet.stream === 2) snapshotChunks.add(packet.chunkId);
  }
  opcode = packet.explicitOpcode ?? opcode;
  context =
    packet.marker & 32
      ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
      : packet.paramBits;
  if (opcode !== 80) continue;
  assert.equal(context, 0);
  assert.ok(packet.stream === 1 || packet.stream === 2);
  packets.push({
    stream: packet.stream,
    chunk: packet.chunkId,
    offset: packet.blockOffset,
    timeSeconds: packet.timeSeconds,
    payloadHex: Buffer.from(packet.payload).toString("hex"),
  });
}
if (mode === undefined)
  assert.equal(packets.length, replaySha256 === long ? 530 : 32);
writeFileSync(
  output === "-" ? 1 : output,
  JSON.stringify(
    {
      replaySha256,
      build: replay.build,
      protocol: replay.protocol,
      geometrySha256,
      materialsSha256,
      meshControllerIds,
      controllers,
      packets,
      ...(mode === undefined ? {} : { snapshotChunks: [...snapshotChunks] }),
      ...(comparePackets ? { comparisonOnly: true } : {}),
    },
    null,
    2,
  ),
  { flag: "wx" },
);
