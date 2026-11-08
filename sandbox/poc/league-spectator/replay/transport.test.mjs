import { test, expect } from "bun:test";
import { openReplay, inspectTransport } from "./transport.mjs";

function fixture({
  latest = true,
  tag = 4,
  compressed = false,
  protocol,
  body,
} = {}) {
  const build = latest ? "16.21.829.8620" : "16.14.794.5912";
  const digest = protocol ?? (latest ? "20e09df23c66b85e" : "509c49fd988fca11");
  const first = Buffer.alloc(16);
  first.writeUInt32LE(1, 5);
  first.writeUInt16LE(42, 9);
  first.writeUInt32LE(0x40000100, 11);
  first[15] = 0xaa;
  body ??= Buffer.concat([first, Buffer.from([0xf0, 10, 1, 2, 0xbb])]);
  const chunk = Buffer.alloc(latest ? 18 : 17);
  chunk.writeUInt32LE(1);
  chunk.writeUInt32LE(1 << 24, 5);
  chunk.writeUInt32LE(body.length, 9);
  if (compressed) chunk.writeUInt32LE(body.length, 13);
  if (latest) chunk[17] = tag;
  const meta = Buffer.from(
    JSON.stringify({
      gameLength: 1000,
      statsJson: JSON.stringify([{ SKIN: "Ornn", TEAM: "100" }]),
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
    body,
    Buffer.alloc(256),
    meta,
    tail,
  ]);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
}

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
