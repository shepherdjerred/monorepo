import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import {
  openReplay,
  replayPacketEnvelopes,
} from "../../../../../packages/scout-for-lol/packages/replay/src/observations/transport.mjs";
import { createPosition944Reader } from "./research/native-terrain-positions-944.mjs";

const [shortReplay, longReplay, mach, radiusReceipt, providerReceipt, output] =
  process.argv.slice(2);
if (process.argv.length !== 8)
  throw Error(
    "Usage: bun audit-exact-fog-provider-positions.mjs <short-rofl> <long-rofl> <exact-mach> <exact-hero-radius-receipt> <exact-provider-receipt> <new-output.json>",
  );
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const shortSha =
  "d7cabb0b7ba965f317863d128238847a0b9b0e4cc0cdbcfa3077c537b10fdf2b";
const longSha =
  "cea604f9944cb8ca433a0655d742e0b741ae4477e0c7100b59a25b3221562668";
const radiusBytes = readFileSync(radiusReceipt);
const providerBytes = readFileSync(providerReceipt);
assert.equal(
  sha(radiusBytes),
  "ccb8c298b89487ef1bfc2570e04f710c1eb3fb98aef6087eb581c7956e854aa4",
);
assert.equal(
  sha(providerBytes),
  "cb604f00a79883ac58cc9771e7daefab4fe7fb44f436bba862f1b177f45a27f5",
);
const proof = JSON.parse(providerBytes);
const longMatch = proof.fixtures.find(({ sha256 }) => sha256 === longSha).match;
const providers = proof.rows;
const radius = JSON.parse(radiusBytes);
const positionKey = (owner, chunk) => `${owner}/${chunk}`;
const targets = new Set(
  radius.findings.map((p) => positionKey(p.ownerId, p.chunk)),
);
const binary = readFileSync(mach);

function census(path, expectedSha, targetKeys) {
  const data = readFileSync(path);
  assert.equal(sha(data), expectedSha);
  const replay = openReplay(Uint8Array.from(data).buffer);
  assert.equal(replay.build, "16.23.840.6595");
  assert.equal(replay.protocol, "8bbfcd5af2bc92db");
  const decode = createPosition944Reader(binary, replay);
  const locations = new Map();
  const streamPacketCounts = {};
  let lastOpcode;
  let context = 0;
  let setterPackets = 0;
  let pendingMovementPackets = 0;
  for (const packet of replayPacketEnvelopes(replay, (input, out) =>
    zstdDecompressSync(input, { maxOutputLength: out.byteLength }),
  )) {
    if (packet.blockOffset === 0) {
      lastOpcode = undefined;
      context = 0;
    }
    lastOpcode = packet.explicitOpcode ?? lastOpcode;
    context =
      packet.marker & 32
        ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
        : packet.paramBits;
    streamPacketCounts[packet.stream] =
      (streamPacketCounts[packet.stream] ?? 0) + 1;
    if (lastOpcode === 985) setterPackets++;
    if (lastOpcode === 145) pendingMovementPackets++;
    const key = positionKey(context, packet.chunkId);
    if (lastOpcode !== 944 || packet.stream !== 2 || !targetKeys.has(key))
      continue;
    assert.ok(!locations.has(key));
    const position = decode(packet.payload);
    assert.ok(position);
    locations.set(key, {
      offset: packet.blockOffset,
      packetSha256: sha(packet.payload),
      payloadHex: Buffer.from(packet.payload).toString("hex"),
      bytes: packet.payload.length,
      positionXZ: [position.x, position.z],
    });
  }
  assert.equal(setterPackets, 0);
  assert.equal(pendingMovementPackets, 0);
  assert.equal(locations.size, targetKeys.size);
  return {
    replaySha256: expectedSha,
    streamPacketCounts,
    setterPackets,
    pendingMovementPackets,
    locations,
  };
}

const { locations: shortLocations, ...short } = census(
  shortReplay,
  shortSha,
  new Set(),
);
assert.equal(shortLocations.size, 0);
const { locations, ...long } = census(longReplay, longSha, targets);
const rows = radius.findings.map((radiusRow) => {
  const registered = providers.find(
    (record) =>
      record.match === longMatch &&
      record.stream === 2 &&
      record.opcode === 1158 &&
      record.chunk === radiusRow.chunk &&
      record.providerId === radiusRow.providerId &&
      record.ownerId === radiusRow.ownerId,
  );
  const position = locations.get(
    positionKey(radiusRow.ownerId, radiusRow.chunk),
  );
  assert.ok(registered && position);
  assert.ok(position.offset > registered.offset);
  return {
    ...radiusRow,
    registration: {
      offset: registered.offset,
      positionXZ: registered.positionXZ,
    },
    opcode944: position,
    equalPosition: registered.positionXZ.every(
      (v, i) => v === position.positionXZ[i],
    ),
  };
});
assert.equal(rows.filter((row) => row.equalPosition).length, 2);
writeFileSync(
  output,
  JSON.stringify(
    {
      short,
      long,
      native: {
        setterOpcode: 985,
        dispatcherRva: 0x6e8550,
        providerLookupRva: 0x215340,
        concretePositionSetterRva: 0x2143d0,
        ownerRefreshCallRva: 0x220608,
        fogProcessingCallRva: 0x22065b,
        pendingMovementOpcode: 145,
        pendingMovementDispatchRva: 0x6e510f,
        pendingMovementReceiverRva: 0xada30,
        pendingMovementTreeInsertCallRva: 0xada82,
      },
      matchedRegistrationRows: rows.length,
      distinctKeyframeOwnerPositionPackets: locations.size,
      rows,
      scope: { ownerMovementGetterReconstructed: false, rasterAdmitted: false },
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
