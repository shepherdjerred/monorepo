import { expect, test } from "vitest";
import { prepareReplayForSeek } from "./prepare.ts";
import { createReplayPacketReader } from "./packets.ts";
import { decodeReplayObservations } from "./observations.ts";

// Synthetic framing/ownership fixture, not a recording or native gameplay proof.
function fixture({
  initialOpcode = 1167,
  terminalOpcode = 1167,
  kills = "0",
  declaredChunks = 3,
} = {}) {
  function packet(
    time: number,
    opcode: number,
    context: number,
    payload: Uint8Array,
  ) {
    const bytes = Buffer.alloc(19 + payload.length);
    bytes[0] = 1;
    bytes.writeFloatLE(time, 1);
    bytes.writeFloatLE(10 + time, 5);
    bytes.writeUInt32LE(payload.length, 9);
    bytes.writeUInt16LE(opcode, 13);
    bytes.writeUInt32LE(context, 15);
    bytes.set(payload, 19);
    return bytes;
  }
  const boundary = new Uint8Array([0, 7]);
  const snapshots = Array.from({ length: 10 }, (_, index) => {
    const payload = new Uint8Array(1263);
    payload[1230] = index < 5 ? 0 : 1;
    return packet(0, 313, 100 + index, payload);
  });
  const bodies = [
    packet(0, initialOpcode, 0, boundary),
    Buffer.concat([packet(0, 1167, 0, boundary), ...snapshots]),
    packet(0.5, terminalOpcode, 0, boundary),
  ];
  const chunks = bodies.map((body, index) => {
    const stored = Bun.zstdCompressSync(body),
      header = Buffer.alloc(18);
    header.writeUInt32LE(index + 1, 0);
    header[8] = [4, 2, 1][index] ?? 0;
    header.writeUInt32LE(body.length, 9);
    header.writeUInt32LE(stored.length, 13);
    header[17] = 4;
    return Buffer.concat([header, stored]);
  });
  const version = Buffer.from("16.23.840.6595"),
    header = Buffer.alloc(15);
  header.write("RIOT");
  header.writeUInt16LE(2, 4);
  Buffer.from("8bbfcd5af2bc92db", "hex").copy(header, 6);
  header[14] = version.length;
  const roster = Array.from({ length: 10 }, (_, index) => ({
    SKIN: `Champion${index.toString()}`,
    TEAM: index < 5 ? "100" : "200",
    CHAMPIONS_KILLED: kills,
    NUM_DEATHS: "0",
    ASSISTS: "0",
    LEVEL: "1",
    TOTAL_TIME_SPENT_DEAD: "0",
    FRIENDLY_TURRET_LOST: "0",
  }));
  const metadata = Buffer.from(
    JSON.stringify({
      gameLength: 1000,
      statsJson: JSON.stringify(roster),
      lastGameChunkId: declaredChunks,
      lastKeyFrameId: 0,
    }),
  );
  const size = Buffer.alloc(4);
  size.writeUInt32LE(metadata.length);
  return Uint8Array.from(
    Buffer.concat([
      header,
      version,
      ...chunks,
      Buffer.alloc(256),
      metadata,
      size,
    ]),
  ).buffer;
}

test("preparation produces identical observations/index with one decompression traversal", () => {
  const bytes = fixture();
  let calls = 0,
    expanded = 0;
  const decompress = (stored: Uint8Array, target: Uint8Array) => {
    calls++;
    expanded += target.length;
    return Bun.zstdDecompressSync(stored);
  };
  const oldReader = createReplayPacketReader(bytes, decompress),
    oldObservations = decodeReplayObservations(bytes, decompress);
  const oldCalls = calls,
    oldExpanded = expanded;
  calls = 0;
  expanded = 0;
  const prepared = prepareReplayForSeek(bytes, decompress);
  expect(calls).toBe(3);
  expect(oldCalls).toBe(6);
  expect(oldExpanded).toBe(expanded * 2);
  expect(prepared.packetReader.keyframes).toEqual(oldReader.keyframes);
  expect(prepared.observations).toEqual(oldObservations);
  expect([...prepared.packetReader.read(1).packets]).toEqual([
    ...oldReader.read(1).packets,
  ]);
  const before = calls;
  expect(prepared.readTurretState(1)?.turrets).toEqual([]);
  expect(calls).toBe(before);
  expect(bytes.byteLength).toBeGreaterThan(0);
});

test.each([
  { initialOpcode: 42 },
  { terminalOpcode: 42 },
  { kills: "1" },
  { declaredChunks: 4 },
])(
  "a malformed index, observation or transport cannot publish prepared state: %j",
  (options) => {
    expect(() =>
      prepareReplayForSeek(fixture(options), Bun.zstdDecompressSync),
    ).toThrow();
  },
);

test("a decompressor detaching the source cannot publish a foreign prepared reader", () => {
  const bytes = fixture();
  let calls = 0;
  const decompress = (stored: Uint8Array) => {
    const decoded = Bun.zstdDecompressSync(stored);
    if (++calls === 3) structuredClone(bytes, { transfer: [bytes] });
    return decoded;
  };
  expect(() => prepareReplayForSeek(bytes, decompress)).toThrow(
    "detached or resized",
  );
});
