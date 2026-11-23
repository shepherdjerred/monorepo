import { expect, test } from "bun:test";
import { buildReplayKeyframeIndex } from "./replay-keyframe-index.mjs";
import { readReplaySeekWindow } from "./replay-seek-window.mjs";
import { openReplay } from "./transport.mjs";

function fixture(snapshotEnd = 0.5) {
  const build = Buffer.from("16.23.840.6595");
  const header = Buffer.alloc(15);
  header.write("RIOT");
  header.writeUInt16LE(2, 4);
  Buffer.from("8bbfcd5af2bc92db", "hex").copy(header, 6);
  header[14] = build.length;
  const packet = (time, opcode, byte) => {
    const record = Buffer.alloc(21);
    record[0] = 1;
    record.writeFloatLE(time, 1);
    record.writeFloatLE(10 + time, 5);
    record.writeUInt32LE(2, 9);
    record.writeUInt16LE(opcode, 13);
    record[20] = byte;
    return record;
  };
  const chunks = [
    [4, [packet(0, 1167, 1)]],
    [2, [packet(0, 1167, 1), packet(0, 42, 2)]],
    [1, [packet(0.25, 42, 3), packet(0.5, 1167, 4)]],
    [2, [packet(0.5, 1167, 4), packet(snapshotEnd, 42, 5)]],
    [1, [packet(0.5, 42, 6), packet(0.75, 42, 7), packet(0.875, 1167, 8)]],
    [1, [packet(1, 1167, 9)]],
  ].map(([stream, records], index) => {
    const body = Buffer.concat(records);
    const stored = Bun.zstdCompressSync(body);
    const header = Buffer.alloc(18);
    header.writeUInt32LE(index + 1);
    header[8] = stream;
    header.writeUInt32LE(body.length, 9);
    header.writeUInt32LE(stored.length, 13);
    header[17] = 4;
    return Buffer.concat([header, stored]);
  });
  const metadata = Buffer.from(
    JSON.stringify({
      gameLength: 1000,
      statsJson: "[]",
      lastGameChunkId: chunks.length,
      lastKeyFrameId: 0,
    }),
  );
  const metadataLength = Buffer.alloc(4);
  metadataLength.writeUInt32LE(metadata.length);
  const bytes = Uint8Array.from(
    Buffer.concat([
      header,
      build,
      ...chunks,
      Buffer.alloc(256),
      metadata,
      metadataLength,
    ]),
  );
  const replay = openReplay(bytes.buffer);
  const index = buildReplayKeyframeIndex(replay, Bun.zstdDecompressSync);
  return { replay, index };
}

const contents = (packets) =>
  Array.from(packets, (packet) => [
    packet.stream,
    packet.timeSeconds,
    packet.payload[1],
  ]);

test("seek window lazily includes the selected snapshot and inclusive gameplay", () => {
  const { replay, index } = fixture();
  let calls = 0;
  const decompress = (packet) => {
    calls++;
    return Bun.zstdDecompressSync(packet);
  };
  const window = readReplaySeekWindow(replay, index, 0.75, decompress);
  expect(window.keyframe).toBe(index[1]);
  expect(calls).toBe(0);
  expect(contents(window.packets)).toEqual([
    [2, 0.5, 4],
    [2, 0.5, 5],
    [1, 0.5, 6],
    [1, 0.75, 7],
  ]);
  expect(calls).toBe(2);
  const initial = readReplaySeekWindow(replay, index, 0, decompress);
  expect(initial.keyframe).toBe(index[0]);
  expect(contents(initial.packets)).toEqual([
    [2, 0, 1],
    [2, 0, 2],
  ]);
});

test("seek window rejects unavailable targets without clamping", () => {
  const { replay, index } = fixture();
  const read = (target, entries = index) =>
    readReplaySeekWindow(replay, entries, target, Bun.zstdDecompressSync);
  for (const time of [-1, NaN, Infinity, 1.001])
    expect(() => read(time)).toThrow("inside the recorded replay duration");
  expect(() => read(0, [])).toThrow("No recorded keyframe");
  expect(contents(read(1).packets).at(-1)).toEqual([1, 1, 9]);
});

test("seek window rejects a snapshot extending beyond its requested time", () => {
  const { replay, index } = fixture(0.75);
  const { packets } = readReplaySeekWindow(
    replay,
    index,
    0.5,
    Bun.zstdDecompressSync,
  );
  expect(() => Array.from(packets)).toThrow(
    "Indexed snapshot extends beyond the requested seek time",
  );
});
