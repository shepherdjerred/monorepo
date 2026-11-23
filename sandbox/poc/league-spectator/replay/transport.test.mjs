import { test, expect } from "bun:test";
import {
  openReplay,
  inspectTransport,
  readReplayKeyframe,
  readReplayPacketsFromKeyframe,
  replayChunks,
  replayPacketEnvelopes,
} from "./transport.mjs";

function fixture({
  latest = true,
  tag = 4,
  compressed = false,
  protocol,
  body,
  build: selectedBuild,
  actualCompression = false,
  participants = [{ SKIN: "Ornn", TEAM: "100" }],
  gameLength = 1000,
  lastGameChunkId,
  stream = 1,
} = {}) {
  const build = selectedBuild ?? (latest ? "16.21.829.8620" : "16.14.794.5912");
  const digest = protocol ?? (latest ? "20e09df23c66b85e" : "509c49fd988fca11");
  const first = Buffer.alloc(16);
  first.writeUInt32LE(1, 5);
  first.writeUInt16LE(42, 9);
  first.writeUInt32LE(0x40000100, 11);
  first[15] = 0xaa;
  body ??= Buffer.concat([first, Buffer.from([0xf0, 10, 1, 2, 0xbb])]);
  const chunk = Buffer.alloc(latest ? 18 : 17);
  chunk.writeUInt32LE(1);
  chunk.writeUInt32LE(stream << 24, 5);
  chunk.writeUInt32LE(body.length, 9);
  const stored = actualCompression ? Bun.zstdCompressSync(body) : body;
  if (compressed || actualCompression) chunk.writeUInt32LE(stored.length, 13);
  if (latest) chunk[17] = tag;
  const meta = Buffer.from(
    JSON.stringify({
      gameLength,
      lastGameChunkId,
      lastKeyFrameId: 0,
      statsJson: JSON.stringify(participants),
    }),
  );
  const header = Buffer.alloc(15);
  header.write("RIOT");
  header.writeUInt16LE(2, 4);
  Buffer.from(digest, "hex").copy(header, 6);
  header[14] = build.length;
  const tail = Buffer.alloc(4);
  tail.writeUInt32LE(meta.length);
  const bytes = Buffer.concat([
    header,
    Buffer.from(build),
    chunk,
    stored,
    Buffer.alloc(256),
    meta,
    tail,
  ]);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
}

test("original footer milliseconds remain distinct from the fractional-seconds playback boundary", () => {
  const replay = openReplay(fixture({ gameLength: 1553143 }));
  expect(replay.durationMilliseconds).toBe(1553143);
  expect(replay.duration).toBe(1553.143);
});

test("participant summoner keys preserve all 64 bits and remain separate from footer order/ID", () => {
  const replay = openReplay(
    fixture({
      participants: [
        {
          SKIN: "Sion",
          TEAM: "100",
          ID: "123",
          SUMMONER_ID: "9007199254740993",
        },
        { SKIN: "Sion", TEAM: "200", ID: "456", SUMMONER_ID: "47750797" },
      ],
    }),
  );
  expect(replay.participantSummonerIds).toEqual([
    "9007199254740993",
    "47750797",
  ]);
  expect(openReplay(fixture()).participantSummonerIds).toEqual([null]);
  for (const value of [
    9007199254740993,
    "18446744073709551616",
    "0",
    "-1",
    "1e6",
  ])
    expect(() =>
      openReplay(
        fixture({
          participants: [{ SKIN: "Ornn", TEAM: "100", SUMMONER_ID: value }],
        }),
      ),
    ).toThrow("summoner identity");
});

for (const latest of [false, true])
  test(`${latest ? "18" : "17"}-byte layout preserves absolute and delta packet fields`, () => {
    const packets = [];
    const result = inspectTransport(
      fixture({ latest }),
      () => {
        throw Error("Unexpected decompression");
      },
      (p) => packets.push(p),
    );
    expect(result.blocks).toBe(2);
    expect(result.gameplayDecoded).toBe(false);
    expect(result.roster).toEqual([{ champion: "Ornn", team: 100 }]);
    expect(
      packets.map((p) => [p.time, p.opcode, p.param, p.payload[0]]),
    ).toEqual([
      [0, 42, 0x40000100, 0xaa],
      [
        latest ? Math.fround(10 * Math.fround(0.001)) : 0.01,
        42,
        0x40000102,
        0xbb,
      ],
    ]);
  });

test("new tag is consumed before compressed payload", () => {
  let calls = 0;
  const result = inspectTransport(
    fixture({ compressed: true }),
    (stored, target) => {
      calls++;
      target.set(stored);
      return target;
    },
  );
  expect(calls).toBe(1);
  expect(result.blocks).toBe(2);
});

test("real zstd payload follows the observed 18-byte header", () => {
  const result = inspectTransport(
    fixture({ actualCompression: true }),
    (stored) => Bun.zstdDecompressSync(stored),
  );
  expect(result.blocks).toBe(2);
});

test("numeric build normalization retains exact protocol admission", () => {
  const result = inspectTransport(
    fixture({ latest: false, build: "16.14.794.05912" }),
    (x) => x,
  );
  expect(result.build).toBe("16.14.794.5912");
  expect(result.blocks).toBe(2);
  expect(() =>
    inspectTransport(fixture({ build: "16.22.834.8910" }), (x) => x),
  ).toThrow("Unsupported transport build/protocol");
});

test("validates all chunk headers even for unselected streams", () => {
  const replay = openReplay(fixture({ tag: 3 }));
  expect(() => [...replayChunks(replay, (x) => x, { streams: [4] })]).toThrow(
    "Unsupported chunk compression tag",
  );
});

for (const latest of [false, true]) {
  test(`${latest ? "18" : "17"}-byte chunk rejects truncated and oversized body bounds`, () => {
    const bytes = fixture({ latest });
    const replay = openReplay(bytes);
    const view = new DataView(bytes);
    view.setUint32(replay.headerEnd + 9, 64 * 1024 * 1024 + 1, true);
    expect(() => inspectTransport(bytes, (x) => x)).toThrow(
      "Invalid chunk header",
    );
    view.setUint32(replay.headerEnd + 9, 1000, true);
    expect(() => inspectTransport(bytes, (x) => x)).toThrow(
      "Invalid chunk size",
    );
    view.setUint32(replay.headerEnd + 9, 0, true);
    expect(() => inspectTransport(bytes, (x) => x)).toThrow(
      "Invalid chunk header",
    );
  });
}
test("unknown protocols and compression tags fail explicitly", () => {
  expect(() =>
    inspectTransport(fixture({ protocol: "0000000000000000" }), (x) => x),
  ).toThrow("Unsupported transport");
  expect(() => inspectTransport(fixture({ tag: 3 }), (x) => x)).toThrow(
    "Unsupported chunk compression tag",
  );
});
test("malformed packet lengths cannot read beyond a chunk", () => {
  const body = Buffer.from([0x90, 0, 255]);
  expect(() => inspectTransport(fixture({ body }), (x) => x)).toThrow(
    "Truncated block",
  );
});
test("invalid metadata, headers and decompression lengths fail", () => {
  expect(() => openReplay(new ArrayBuffer(12))).toThrow("Expected a ROFL");
  const bytes = fixture();
  new DataView(bytes).setUint32(bytes.byteLength - 4, 0xffffffff, true);
  expect(() => openReplay(bytes)).toThrow("Invalid metadata bounds");
  expect(() =>
    inspectTransport(fixture({ compressed: true }), () => new Uint8Array(0)),
  ).toThrow("decompression length mismatch");
});

const envelopeProtocol = "8bbfcd5af2bc92db";
const envelopeBuild = "16.23.840.6595";
const envelopes = Buffer.from([
  // Wide clock 0x3f800000, second clock 0x40000000, length 1, opcode 42,
  // wide parameter 0x80000000, payload 0xaa.
  1, 0, 0, 0x80, 0x3f, 0, 0, 0, 0x40, 1, 0, 0, 0, 42, 0, 0, 0, 0, 0x80, 0xaa,
  // Narrow clock 0xfe, second clock 0x40400000, length 1, implicit opcode,
  // narrow parameter 0xff, payload 0xbb.
  0xf2, 0xfe, 0, 0, 0x40, 0x40, 1, 0xff, 0xbb,
]);

function keyframeFixture(laterStreams = []) {
  const options = {
    build: envelopeBuild,
    protocol: envelopeProtocol,
    lastGameChunkId: 2 + laterStreams.length,
    actualCompression: true,
  };
  const boundary = Buffer.concat([envelopes.subarray(0, 20), Buffer.of(0xcc)]);
  boundary.writeUInt32LE(2, 9);
  boundary.writeUInt16LE(1167, 13);
  const sequential = openReplay(fixture({ ...options, body: envelopes }));
  const keyframe = openReplay(
    fixture({
      ...options,
      stream: 2,
      body: Buffer.concat([boundary, envelopes.subarray(20)]),
    }),
  );
  const storedChunkBytes = keyframe.end - keyframe.headerEnd;
  const suffix = laterStreams.map((stream) => {
    const later = openReplay(fixture({ ...options, stream, body: envelopes }));
    return later.bytes.subarray(later.headerEnd, later.end);
  });
  const bytes = new Uint8Array(
    sequential.bytes.length +
      storedChunkBytes +
      suffix.reduce((sum, chunk) => sum + chunk.length, 0),
  );
  bytes.set(sequential.bytes.subarray(0, sequential.end));
  bytes.set(
    keyframe.bytes.subarray(keyframe.headerEnd, keyframe.end),
    sequential.end,
  );
  let position = sequential.end + storedChunkBytes;
  for (const chunk of suffix) {
    bytes.set(chunk, position);
    position += chunk.length;
  }
  bytes.set(sequential.bytes.subarray(sequential.end), position);
  return {
    replay: openReplay(bytes.buffer),
    entry: {
      chunkOffset: sequential.end,
      storedChunkBytes,
      chunkId: 1,
      timeSeconds: 1,
      secondTimeBits: 0x40000000,
    },
  };
}

test("keyframe packet reads are lazy and expand only the selected snapshot and suffix gameplay", () => {
  const { replay, entry } = keyframeFixture([3, 1, 2, 1]);
  const full = [...replayPacketEnvelopes(replay, Bun.zstdDecompressSync)];
  const seen = [];
  const cursor = readReplayPacketsFromKeyframe(replay, entry, (stored) => {
    seen.push(stored.byteOffset - replay.bytes.byteOffset - 18);
    return Bun.zstdDecompressSync(stored);
  });
  expect(seen).toEqual([]);
  const first = cursor.next().value;
  const second = cursor.next().value;
  expect(seen).toEqual([entry.chunkOffset]);
  const third = cursor.next().value;
  expect(seen).toEqual([entry.chunkOffset, third.chunkOffset]);
  const read = [first, second, third, ...cursor];
  expect(read).toEqual(
    full.filter(
      ({ stream, chunkOffset }) =>
        chunkOffset === entry.chunkOffset ||
        (chunkOffset > entry.chunkOffset && stream === 1),
    ),
  );
  expect(seen).toEqual([
    entry.chunkOffset,
    third.chunkOffset,
    read.at(-1).chunkOffset,
  ]);
});

test("keyframe packet reads check skipped suffix headers", () => {
  const { replay, entry } = keyframeFixture([3, 1]);
  replay.bytes[entry.chunkOffset + entry.storedChunkBytes + 17] = 0;
  const cursor = readReplayPacketsFromKeyframe(
    replay,
    entry,
    Bun.zstdDecompressSync,
  );
  expect(cursor.next().value.stream).toBe(2);
  expect(cursor.next().value.stream).toBe(2);
  expect(() => cursor.next()).toThrow("Unsupported chunk compression tag");
});

test("indexed keyframe expands exactly one chunk with sequential envelope parity", () => {
  const { replay, entry } = keyframeFixture();
  let calls = 0;
  const decompress = (stored) => {
    calls++;
    return Bun.zstdDecompressSync(stored);
  };
  const sequential = [...replayPacketEnvelopes(replay, decompress)];
  expect(calls).toBe(2);
  calls = 0;
  const indexed = [...readReplayKeyframe(replay, entry, decompress)];
  expect(calls).toBe(1);
  expect(indexed).toEqual(sequential.filter(({ stream }) => stream === 2));

  replay.view.setUint32(entry.chunkOffset, 0, true);
  const zeroId = [
    ...readReplayKeyframe(replay, { ...entry, chunkId: 0 }, decompress),
  ];
  expect(zeroId).toEqual(indexed.map((record) => ({ ...record, chunkId: 0 })));
});

test("indexed keyframe rejects bad ranges, headers and boundary identity before yielding", () => {
  const { replay, entry } = keyframeFixture();
  const read = (overrides) =>
    readReplayKeyframe(
      replay,
      { ...entry, ...overrides },
      Bun.zstdDecompressSync,
    ).next();
  expect(() => read({ chunkOffset: replay.end })).toThrow(
    "Invalid indexed keyframe range",
  );
  expect(() => read({ chunkOffset: entry.chunkOffset + 0.5 })).toThrow(
    "Invalid indexed keyframe range",
  );
  expect(() => read({ storedChunkBytes: entry.storedChunkBytes - 1 })).toThrow(
    "Indexed keyframe header mismatch",
  );
  expect(() => read({ chunkId: 99 })).toThrow(
    "Indexed keyframe header mismatch",
  );
  expect(() => read({ timeSeconds: 0 })).toThrow(
    "Indexed keyframe boundary mismatch",
  );
  expect(() => read({ secondTimeBits: 0x40400000 })).toThrow(
    "Indexed keyframe boundary mismatch",
  );

  const foreign = openReplay(
    fixture({
      build: envelopeBuild,
      protocol: envelopeProtocol,
      lastGameChunkId: 1,
      stream: 2,
      actualCompression: true,
      body: envelopes,
    }),
  );
  expect(() =>
    readReplayKeyframe(
      foreign,
      {
        ...entry,
        chunkOffset: foreign.headerEnd,
        storedChunkBytes: foreign.end - foreign.headerEnd,
      },
      Bun.zstdDecompressSync,
    ).next(),
  ).toThrow("Indexed keyframe boundary mismatch");
});

test("16.23 preserves both recorded clocks and bounds without interpreting gameplay fields", () => {
  for (const build of ["16.23.839.9929", envelopeBuild]) {
    const replay = openReplay(
      fixture({
        build,
        protocol: envelopeProtocol,
        lastGameChunkId: 1,
        actualCompression: true,
        body: envelopes,
      }),
    );
    const packets = [...replayPacketEnvelopes(replay, Bun.zstdDecompressSync)];
    expect(packets).toEqual([
      {
        chunkId: 1,
        stream: 1,
        chunkOffset: replay.headerEnd,
        storedChunkBytes: replay.end - replay.headerEnd,
        blockOffset: 0,
        marker: 1,
        firstTimeBits: 0x3f800000,
        secondTimeBits: 0x40000000,
        explicitOpcode: 42,
        paramBits: 0x80000000,
        payload: new Uint8Array([0xaa]),
      },
      {
        chunkId: 1,
        stream: 1,
        chunkOffset: replay.headerEnd,
        storedChunkBytes: replay.end - replay.headerEnd,
        blockOffset: 20,
        marker: 0xf2,
        firstTimeBits: 0xfe,
        secondTimeBits: 0x40400000,
        explicitOpcode: null,
        paramBits: 0xff,
        payload: new Uint8Array([0xbb]),
      },
    ]);
    expect(() => [...replayChunks(replay, Bun.zstdDecompressSync)]).toThrow(
      "Unsupported transport build/protocol",
    );
  }
});

test("packet envelopes require exact build/protocol and complete chunk/record boundaries", () => {
  const read = (options) => [
    ...replayPacketEnvelopes(
      openReplay(
        fixture({
          build: envelopeBuild,
          protocol: envelopeProtocol,
          lastGameChunkId: 1,
          body: envelopes,
          ...options,
        }),
      ),
      (stored) => stored,
    ),
  ];
  expect(() => read({ build: "16.23.840.6596" })).toThrow(
    "Unsupported packet envelope build/protocol",
  );
  expect(() => read({ protocol: "20e09df23c66b85e" })).toThrow(
    "Unsupported packet envelope build/protocol",
  );
  expect(() => read({ lastGameChunkId: undefined })).toThrow(
    "Invalid declared replay chunk count",
  );
  expect(() => read({ lastGameChunkId: 2 })).toThrow(
    "Replay chunk count mismatch",
  );
  expect(() => read({ body: envelopes.subarray(0, -1) })).toThrow(
    "Truncated packet envelope",
  );
  expect(() => read({ body: envelopes.subarray(0, 8) })).toThrow(
    "Truncated packet envelope",
  );
  const typeThree = Buffer.from(envelopes);
  typeThree[0] = 3;
  expect(read({ body: typeThree })).toHaveLength(2);
  expect(read({ build: "16.23.839.9929", body: typeThree })).toHaveLength(2);
  const unknownType = Buffer.from(envelopes);
  unknownType[0] = 4;
  expect(() => read({ body: unknownType })).toThrow(
    "Unsupported packet marker 4",
  );
});
