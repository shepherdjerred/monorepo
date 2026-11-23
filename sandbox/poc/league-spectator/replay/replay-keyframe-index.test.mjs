import { expect, test } from "bun:test";
import {
  buildReplayKeyframeIndex,
  findReplayKeyframe,
} from "./replay-keyframe-index.mjs";
import { openReplay } from "./transport.mjs";

function packet(
  secondTimeBits,
  secondByte,
  { opcode = 1167, firstByte = 22, timeSeconds = 0, narrow = false } = {},
) {
  const width = narrow ? 1 : 4;
  const bytes = Buffer.alloc(11 + width);
  bytes[0] = narrow ? 0xb1 : 0x31;
  if (!narrow) bytes.writeFloatLE(timeSeconds, 1);
  bytes.writeUInt32LE(secondTimeBits, 1 + width);
  bytes[5 + width] = 2;
  bytes.writeUInt16LE(opcode, 6 + width);
  bytes[9 + width] = firstByte;
  bytes[10 + width] = secondByte;
  return bytes;
}

function fixture(chunks) {
  const build = Buffer.from("16.23.840.6595");
  const header = Buffer.alloc(15);
  header.write("RIOT");
  header.writeUInt16LE(2, 4);
  Buffer.from("8bbfcd5af2bc92db", "hex").copy(header, 6);
  header[14] = build.length;
  const ranges = [];
  let offset = header.length + build.length;
  const chunkData = chunks.map(([stream, body, compress], index) => {
    const chunkHeader = Buffer.alloc(18);
    const stored = compress ? Bun.zstdCompressSync(body) : body;
    chunkHeader.writeUInt32LE(index + 1, 0);
    chunkHeader[8] = stream;
    chunkHeader.writeUInt32LE(body.length, 9);
    chunkHeader.writeUInt32LE(compress ? stored.length : 0, 13);
    chunkHeader[17] = 4;
    const bytes = Buffer.concat([chunkHeader, stored]);
    ranges.push({ chunkOffset: offset, storedChunkBytes: bytes.length });
    offset += bytes.length;
    return bytes;
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
  const bytes = Buffer.concat([
    header,
    build,
    ...chunkData,
    Buffer.alloc(256),
    metadata,
    metadataLength,
  ]);
  const replay = openReplay(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  return { replay, ranges };
}

const initialBits = 0x42402d4d;
const laterBits = 0x42402d4e;
const initialPair = [
  [4, packet(initialBits, 10)],
  [
    2,
    Buffer.concat([
      packet(initialBits, 10),
      packet(initialBits, 1, { opcode: 42 }),
    ]),
    true,
  ],
];

test("indexes exact initial and later keyframe byte ranges in file order", () => {
  const { replay, ranges } = fixture([
    ...initialPair,
    [
      1,
      Buffer.concat([
        packet(laterBits, 0, { opcode: 42 }),
        packet(laterBits, 2),
      ]),
    ],
    [2, packet(laterBits, 2, { firstByte: 99, timeSeconds: 0.5 }), true],
    [1, packet(laterBits + 1, 3)],
  ]);
  expect(buildReplayKeyframeIndex(replay, Bun.zstdDecompressSync)).toEqual([
    {
      chunkId: 2,
      ...ranges[1],
      timeSeconds: 0,
      secondTimeBits: initialBits,
      predecessorChunkId: 1,
      predecessorStream: 4,
    },
    {
      chunkId: 4,
      ...ranges[3],
      timeSeconds: 0.5,
      secondTimeBits: laterBits,
      predecessorChunkId: 3,
      predecessorStream: 1,
    },
  ]);
});

test("rejects malformed, missing and nonadjacent boundary records", () => {
  const scan = (chunks) =>
    buildReplayKeyframeIndex(fixture(chunks).replay, Bun.zstdDecompressSync);
  expect(() => scan([[2, packet(initialBits, 10)]])).toThrow(
    "Missing adjacent predecessor",
  );
  expect(() =>
    scan([
      [4, Buffer.concat([packet(initialBits, 10), packet(initialBits, 10)])],
      initialPair[1],
    ]),
  ).toThrow("Expected one initial keyframe boundary record");
  expect(() =>
    scan([...initialPair, [1, packet(laterBits, 2, { opcode: 42 })]]),
  ).toThrow("Invalid keyframe boundary");
  expect(() =>
    scan([
      ...initialPair,
      [1, packet(laterBits, 2)],
      [2, packet(laterBits, 3)],
    ]),
  ).toThrow("Missing adjacent predecessor");
  expect(() =>
    scan([
      ...initialPair,
      [1, packet(laterBits, 2)],
      [1, packet(laterBits, 3)],
      [2, packet(laterBits, 2)],
    ]),
  ).toThrow("Missing adjacent predecessor");
  expect(() =>
    scan([
      ...initialPair,
      [1, packet(laterBits, 2)],
      [2, packet(laterBits, 2, { timeSeconds: 0.5 })],
      [2, packet(laterBits, 2)],
    ]),
  ).toThrow("Missing adjacent predecessor");
});

test("rejects nonfinite, negative and nonincreasing secondary clock values", () => {
  for (const bits of [
    0x7f800000,
    0x7fc00000,
    0xbf800000,
    initialBits,
    initialBits - 1,
  ]) {
    const { replay } = fixture([
      ...initialPair,
      [1, packet(bits, 2)],
      [2, packet(bits, 2)],
    ]);
    expect(() =>
      buildReplayKeyframeIndex(replay, Bun.zstdDecompressSync),
    ).toThrow("Invalid secondary clock order");
  }
});

test("primary keyframe clocks must be absolute, strictly increasing and within the replay", () => {
  const scan = (chunks) =>
    buildReplayKeyframeIndex(fixture(chunks).replay, Bun.zstdDecompressSync);
  expect(() =>
    scan([initialPair[0], [2, packet(initialBits, 10, { narrow: true })]]),
  ).toThrow("Expected absolute primary clock");
  for (const timeSeconds of [0.1, -0]) {
    expect(() =>
      scan([initialPair[0], [2, packet(initialBits, 10, { timeSeconds })]]),
    ).toThrow("Invalid primary clock");
  }
  for (const timeSeconds of [0, -0.5, 1.25, Infinity, NaN]) {
    expect(() =>
      scan([
        ...initialPair,
        [1, packet(laterBits, 2)],
        [2, packet(laterBits, 2, { timeSeconds })],
      ]),
    ).toThrow("Invalid primary clock");
  }
});

test("finds the keyframe at or immediately before a valid recorded time", () => {
  const index = [
    { timeSeconds: 0 },
    { timeSeconds: 0.5 },
    { timeSeconds: 0.75 },
  ];
  expect(findReplayKeyframe([], 0)).toBeNull();
  expect(findReplayKeyframe(index, 0)).toBe(index[0]);
  expect(findReplayKeyframe(index, 0.49)).toBe(index[0]);
  expect(findReplayKeyframe(index, 0.5)).toBe(index[1]);
  expect(findReplayKeyframe(index, 0.74)).toBe(index[1]);
  expect(findReplayKeyframe(index, 0.75)).toBe(index[2]);
  expect(findReplayKeyframe(index, 100)).toBe(index[2]);
  for (const invalid of [-1, NaN, Infinity])
    expect(() => findReplayKeyframe(index, invalid)).toThrow(
      "Invalid replay keyframe lookup time",
    );
});
