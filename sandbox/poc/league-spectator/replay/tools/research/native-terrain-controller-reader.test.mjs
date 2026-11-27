import assert from "node:assert/strict";
import test from "node:test";
import {
  currentTerrainPositionBuild,
  position944SubstitutionIndex,
  swapAdjacentBits,
  terrainPositionBuild,
  terrainPositionProtocol,
} from "./native-terrain-byte-codecs.mjs";
import { createCurrentMap11ControllerReader } from "./native-terrain-controller-reader.mjs";
import { createMap11ControllerPacketCollector } from "./native-terrain-controller-visibility.mjs";

const replay = {
  build: currentTerrainPositionBuild,
  protocol: terrainPositionProtocol,
};
const identityCodecs = {
  decodePositionByte: (byte) =>
    (position944SubstitutionIndex(byte) + 0x67) & 255,
};
const encodeNameByte = (decoded) =>
  swapAdjacentBits(((decoded - 4) & 255) ^ 0xb0);

test("Map11 controller reader bounds exact-build name varints and packet width", () => {
  const read = createCurrentMap11ControllerReader(replay, identityCodecs);
  const body = Uint8Array.of(0x0a, encodeNameByte(0xac), encodeNameByte(2));
  assert.equal(read(body).name, 300);
  assert.throws(() => read(body.subarray(0, 2)), /Truncated/);
  assert.throws(() => read(Uint8Array.of(...body, 0)), /Trailing/);
  assert.throws(
    () => read(Uint8Array.of(0x0a, ...Array(5).fill(encodeNameByte(0xff)))),
    /varint/,
  );
  assert.throws(
    () =>
      createCurrentMap11ControllerReader(
        { ...replay, build: terrainPositionBuild },
        identityCodecs,
      ),
    /exact current replay layout/,
  );
});

test("Map11 controller collector preserves physical snapshot envelopes", () => {
  const collector = createMap11ControllerPacketCollector();
  const payload = Uint8Array.of(1);
  const envelope = {
    stream: 2,
    chunkId: 9,
    blockOffset: 0,
    timeSeconds: 60,
    explicitOpcode: 80,
    paramBits: 0,
    marker: 0,
    payload,
  };
  collector.observe(envelope);
  payload[0] = 2;
  collector.observe({ ...envelope, blockOffset: 1, explicitOpcode: undefined });
  collector.observe({ ...envelope, chunkId: 10, explicitOpcode: undefined });
  const { packets, snapshotChunks } = collector.finish();
  assert.deepEqual(snapshotChunks, [9, 10]);
  assert.deepEqual(
    packets.map((packet) => [...packet.payload]),
    [[1], [2]],
  );
  assert.throws(
    () => collector.observe({ ...envelope, paramBits: 1 }),
    /context/,
  );
});
