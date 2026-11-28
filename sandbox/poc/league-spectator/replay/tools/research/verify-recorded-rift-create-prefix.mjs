import assert from "node:assert/strict";
import {
  createPreparedTerrainByteCodecs,
  currentTerrainClientArchiveSha256,
} from "./native-terrain-byte-codecs.mjs";
import {
  createRecordedRiftCreatePrefixReader,
  createRecordedRiftPlacementGrid,
} from "./native-terrain-effect-create-prefix.mjs";

const [packets, native, preparedMaps] = Bun.argv.slice(2);
assert.equal(
  Bun.argv.length,
  5,
  "Usage: bun verify-recorded-rift-create-prefix.mjs CORPUS NATIVE_RECEIPT POSITION_CODECS",
);
const [bytes, receipt, maps] = await Promise.all([
  Bun.file(packets).bytes(),
  Bun.file(native).json(),
  Bun.file(preparedMaps).bytes(),
]);
const corpus = JSON.parse(new TextDecoder().decode(bytes));
assert.equal(receipt.schema, 1);
assert.equal(receipt.build, corpus.build);
assert.equal(receipt.protocol, corpus.protocol);
assert.equal(receipt.replaySha256, corpus.replaySha256);
assert.equal(receipt.executableSha256, currentTerrainClientArchiveSha256);
assert.equal(
  receipt.corpusSha256,
  Bun.CryptoHasher.hash("sha256", bytes, "hex"),
);
assert.equal(receipt.packets.length, corpus.packets.length);
if (receipt.entryPrefixes !== undefined)
  assert.equal(receipt.entryPrefixes.length, corpus.packets.length);
const codecs = await createPreparedTerrainByteCodecs(maps, corpus, {
  allowCurrentBuild: true,
});
const reader = createRecordedRiftCreatePrefixReader(corpus, codecs);
let groupCount = 0;
let entries = 0;
let groupsWithOptionalIds = 0;
let groupsWithOptionalVectors = 0;
let entryPrefixes = 0;
let entriesWithVector = 0;
const keyModes = new Set();
for (const [index, [sequence, groups]] of receipt.packets.entries()) {
  const [, expectedSequence, , hex] = corpus.packets[index];
  assert.equal(sequence, expectedSequence);
  assert.match(hex, /^(?:[a-f\d]{2})+$/u);
  const body = Buffer.from(hex, "hex");
  const header = reader.packetPrefix(body);
  assert.deepEqual(header, {
    groupCount: groups.length,
    firstGroupOffset: groups[0]?.[0] ?? body.length,
  });
  let previousOffset = header.firstGroupOffset - 1;
  let entriesInPacket = 0;
  for (let wire = 0; wire < groups.length; wire++) {
    // The native array alternates forward and reverse destinations.
    const index = wire % 2 === 0 ? wire / 2 : groups.length - (wire + 1) / 2;
    const [offset, entryOffset, resourceKey, entryCount] = groups[index];
    assert.ok(offset > previousOffset, `Bad wire order at packet ${sequence}`);
    previousOffset = offset;
    assert.deepEqual(
      reader.groupPrefix(body, offset),
      { resourceKey, entryCount, entryOffset },
      `Group prefix differs at packet ${sequence}, logical group ${index}`,
    );
    assert.equal(
      reader.groupPrefix(body.subarray(0, entryOffset - 1), offset),
      null,
    );
    groupCount++;
    entries += entryCount;
    entriesInPacket += entryCount;
    keyModes.add(body[offset] & 7);
    if (body[offset + 2] & 2) groupsWithOptionalIds++;
    if (body[offset] & 16) groupsWithOptionalVectors++;
  }
  if (receipt.entryPrefixes !== undefined) {
    const [entrySequence, rows] = receipt.entryPrefixes[index];
    assert.equal(entrySequence, sequence);
    assert.equal(rows.length, entriesInPacket);
    for (const [offset, nextOffset, vectorBits, xGridWords] of rows) {
      assert.deepEqual(
        reader.entryPrefix(body, offset),
        { nextOffset, vectorBits, xGridWords },
        `Entry prefix differs at packet ${sequence}, byte ${offset}`,
      );
      assert.equal(
        reader.entryPrefix(body.subarray(0, nextOffset - 1), offset),
        null,
      );
      entryPrefixes++;
      if (body[offset + 3] & 2) entriesWithVector++;
    }
  }
}
assert.equal(reader.packetPrefix(new Uint8Array()), null);
assert.deepEqual(reader.packetPrefix(Uint8Array.of(0)), {
  groupCount: 0,
  firstGroupOffset: 1,
});
assert.equal(reader.packetPrefix(Uint8Array.of(0, 0)), null);
// These minimal groups use the four constructor presets. The native
// probe verifies the logical keys without any entry bodies.
for (const [mode, resourceKey] of [
  [1, 2],
  [2, 0xffff_ffff],
  [6, 1],
  [7, 0],
]) {
  assert.deepEqual(reader.groupPrefix(Uint8Array.of(8 | mode, 15, 1), 0), {
    resourceKey,
    entryCount: 0,
    entryOffset: 3,
  });
}
assert.throws(() =>
  createRecordedRiftCreatePrefixReader(
    { ...corpus, build: "16.23.840.6595" },
    codecs,
  ),
);
let gridChecks = 0;
let entryPresetChecks = 0;
for (const [
  hex,
  [offset, nextOffset, vectorBits, xGridWords],
] of receipt.entryPresetControls ?? []) {
  assert.deepEqual(reader.entryPrefix(Buffer.from(hex, "hex"), offset), {
    nextOffset,
    vectorBits,
    xGridWords,
  });
  entryPresetChecks++;
}
if (receipt.grid !== undefined) {
  const project = createRecordedRiftPlacementGrid(corpus, receipt.grid.bounds);
  const bits = new DataView(new ArrayBuffer(4));
  for (const axis of [0, 2]) {
    for (let word = -32768; word <= 32767; word++) {
      bits.setFloat32(0, project(axis, word), true);
      assert.equal(
        bits.getUint32(0, true),
        receipt.grid.expectedBits[gridChecks++],
      );
    }
  }
  assert.equal(gridChecks, receipt.grid.expectedBits.length);
}
console.log(
  JSON.stringify({
    packetPrefixes: receipt.packets.length,
    groupPrefixes: groupCount,
    entryCount: entries,
    entryPrefixes,
    entriesWithVector,
    entryPresetChecks,
    gridChecks,
    groupsWithOptionalIds,
    groupsWithOptionalVectors,
    keyModes: [...keyModes].sort(),
    entryBodiesDecoded: false,
  }),
);
