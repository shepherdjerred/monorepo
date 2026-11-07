import { test, expect } from "bun:test";
import {
  readLatestReplayStartup,
  assertLatestStartupSceneMap,
} from "./latest-replay-startup.mjs";
import { replayChunks } from "./transport.mjs";

function packet({ opcode = 728, time = 0, param = 0 } = {}) {
  const body = Buffer.alloc(16);
  body.writeFloatLE(time, 1);
  body.writeUInt32LE(1, 5);
  body.writeUInt16LE(opcode, 9);
  body.writeUInt32LE(param, 11);
  body[15] = 0xab;
  return body;
}
function replay(chunks) {
  const bytes = Buffer.concat(
    chunks.map(({ stream, body, compressed = false }, index) => {
      const header = Buffer.alloc(18);
      header.writeUInt32LE(index + 1);
      header.writeUInt32LE(stream << 24, 5);
      header.writeUInt32LE(body.length, 9);
      if (compressed) header.writeUInt32LE(body.length, 13);
      header[17] = 4;
      return Buffer.concat([header, body]);
    }),
  );
  return {
    bytes,
    view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    headerEnd: 0,
    end: bytes.length,
    build: "16.21.829.8620",
    protocol: "20e09df23c66b85e",
  };
}
const scene = (id) => new TextEncoder().encode(JSON.stringify({ map: { id } }));
function controls(input, options = {}) {
  const calls = [];
  return {
    calls,
    args: {
      replay: input,
      decompress: () => {
        throw Error("Unrelated stream decompressed");
      },
      decoder: {
        observePacket: (...args) => {
          calls.push(args);
          return { complete: true };
        },
      },
      reader: { read: () => ({ configuredMapId: 12, mode: "KIWI" }) },
      ...options,
    },
  };
}
test("startup keeps independent provenance and filters decompression before unrelated streams", async () => {
  const input = replay([
    { stream: 1, body: Buffer.from([0xff]), compressed: true },
    { stream: 3, body: Buffer.concat([packet({ opcode: 727 }), packet()]) },
  ]);
  const { args, calls } = controls(input, { sceneBytes: scene(12) });
  const result = await readLatestReplayStartup(args);
  expect(calls).toEqual([[728, Buffer.from([0xab]), 0]]);
  expect(result.mode).toBe("KIWI");
  expect(result.source).toMatchObject({
    stream: 3,
    chunkId: 2,
    blockOffset: 16,
    streamSequence: 1,
    opcode: 728,
    time: 0,
    param: 0,
  });
  expect(result.source).not.toHaveProperty("transportSequence");
  expect(result.source.payloadSha256).toHaveLength(64);
});
test("missing, duplicate, mistimed, contextual and incomplete startup packets fail", async () => {
  for (const [body, message] of [
    [packet({ opcode: 727 }), "missing 728"],
    [Buffer.concat([packet(), packet()]), "duplicate 728"],
    [packet({ time: 1 }), "identity"],
    [packet({ param: 7 }), "identity"],
  ]) {
    await expect(
      readLatestReplayStartup(controls(replay([{ stream: 3, body }])).args),
    ).rejects.toThrow(message);
  }
  await expect(
    readLatestReplayStartup(
      controls(replay([{ stream: 3, body: packet() }]), {
        decoder: { observePacket: () => ({ complete: false }) },
      }).args,
    ),
  ).rejects.toThrow("complete packet");
});
test("scene-independent startup decoding cannot authorize a mismatching world map", async () => {
  const { args } = controls(replay([{ stream: 3, body: packet() }]));
  const startup = await readLatestReplayStartup(args);
  expect(startup.configuredMapId).toBe(12);
  expect(() => assertLatestStartupSceneMap(startup, scene(11))).toThrow(
    "Recorded map 12 differs from selected scene map 11",
  );
  await expect(
    readLatestReplayStartup({ ...args, sceneBytes: scene(11) }),
  ).rejects.toThrow("differs");
  expect(() =>
    assertLatestStartupSceneMap(startup, new Uint8Array([0xff])),
  ).toThrow();
  expect(() => assertLatestStartupSceneMap(startup, scene("12"))).toThrow(
    "identities",
  );
});
test("stream filtering preserves whole-replay header bounds and rejects malformed selections", () => {
  const input = replay([
    { stream: 1, body: packet(), compressed: true },
    { stream: 3, body: packet() },
  ]);
  let count = 0;
  const decompress = (stored, output) => {
    count++;
    output.set(stored);
    return output;
  };
  expect(
    [...replayChunks(input, decompress)].map((chunk) => chunk.stream),
  ).toEqual([1, 3]);
  expect(count).toBe(1);
  expect(
    [...replayChunks(input, decompress, { streams: [3] })].map(
      (chunk) => chunk.stream,
    ),
  ).toEqual([3]);
  expect(count).toBe(1);
  for (const streams of [[], [3, 3], [-1], [256], "3"])
    expect(() => [...replayChunks(input, decompress, { streams })]).toThrow(
      "stream selection",
    );
  input.bytes[17] = 9;
  expect(() => [...replayChunks(input, decompress, { streams: [3] })]).toThrow(
    "compression tag",
  );
});
