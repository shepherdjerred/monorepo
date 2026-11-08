import { decodeAnimation } from "./animation-decoder.mjs";
export const GAMEPLAY_OPCODES = [
  107, 921, 398, 259, 351, 197, 879, 550, 751, 861, 411, 330, 181, 781, 908,
  1133, 386, 815, 1012, 1224, 487, 343, 280,
];
// Exact-build research decoder. See README for provenance and limitations.
export const BUILD = "16.14.794.5912";
export const PROTOCOL = "509c49fd988fca11";
export const EXE_SHA256 =
  "34de26710352fcf4360b27691cecf77843a0ea338cd455be4fabb63fb467984f";
export const FIXTURE_SHA256 =
  "c4b19a56c2451601591815febb3513d53e7b38f95ab8937e4b417293aead6d85";

const ror = (v, n) => ((v >>> n) | (v << (8 - n))) & 255;
const swap = (v) => ((v & 0x55) << 1) | ((v >>> 1) & 0x55);
// Derived from the matching executable: vector reader RVA 0xfacb10.
const byteTransform = (v) =>
  ror(
    (ror(swap(((((v - 0x47) & 255) ^ 0x77) - 0x3e) & 255), 2) - 0x17) & 255,
    1,
  );
// Prefix varuint reader RVA 0xf880c0, selected by bits 1..3.
const prefixTransform = (v) => ror(swap(ror(~ror(v, 5) & 255, 1)), 1);

export function movementBytes(payload) {
  let cursor = 0;
  const read = () => {
    if (cursor >= payload.length) throw new Error("Truncated movement payload");
    return payload[cursor++];
  };
  const variable = (transform) => {
    let value = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      const byte = transform(read());
      value += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) return value;
    }
    throw new Error("Oversized movement varuint");
  };
  const selector = read();
  if ([0, 1, 5, 7].includes((selector >> 1) & 7)) variable(prefixTransform);
  if (!(selector & 1)) return new Uint8Array();
  const length = variable(byteTransform);
  if (length > payload.length - cursor)
    throw new Error("Movement vector exceeds packet");
  const result = new Uint8Array(length);
  let lo = 0,
    hi = length - 1;
  while (lo < hi) {
    result[lo++] = byteTransform(read());
    result[hi--] = byteTransform(read());
  }
  if (lo === hi) result[lo] = byteTransform(read());
  // The remaining field is not movement data. Preserve it at the packet layer.
  return result;
}

export function movementPaths(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const paths = [];
  let cursor = 0;
  const need = (n) => {
    if (cursor + n > bytes.length) throw new Error("Truncated movement record");
  };
  const signed16 = (v) => (v & 0x8000 ? v - 0x10000 : v);
  while (cursor < bytes.length) {
    need(10);
    const type = view.getUint16(cursor, true);
    const entityId = view.getUint32(cursor + 2, true);
    const speed = view.getFloat32(cursor + 6, true);
    cursor += 10;
    if (!Number.isFinite(speed) || speed < 0 || speed > 5000)
      throw new Error("Invalid movement speed");
    if (type & 1) {
      need(1);
      cursor++;
    }
    const count = (type & 255) >> 1;
    if (!count) throw new Error("Movement without waypoints");
    const bitmap = cursor;
    const bitmapSize = count > 1 ? ((count - 2) >> 2) + 1 : 0;
    need(bitmapSize);
    cursor += bitmapSize;
    let x = 0,
      z = 0,
      bit = 0;
    const waypoints = [];
    for (let index = 0; index < count; index++) {
      const coordinate = (previous) => {
        const delta =
          index > 0 && (bytes[bitmap + (bit >> 3)] >> (bit++ & 7)) & 1;
        need(delta ? 1 : 2);
        // Signed deltas: selected by next-anchor residual comparison, see README.
        // This differs from RoflLens semantic paths; decoded byte parity is unchanged.
        const value = delta
          ? (previous + view.getInt8(cursor)) & 65535
          : view.getUint16(cursor, true);
        cursor += delta ? 1 : 2;
        return value;
      };
      x = coordinate(x);
      z = coordinate(z);
      waypoints.push([signed16(x) * 2 + 7358, signed16(z) * 2 + 7412]);
    }
    paths.push({ entityId, speed, waypoints });
  }
  return paths;
}

export function parseReplay(
  buffer,
  decompress,
  progress = () => {},
  { collectGameplay = false } = {},
) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const text = new TextDecoder();
  if (
    bytes.length < 32 ||
    text.decode(bytes.subarray(0, 4)) !== "RIOT" ||
    view.getUint16(4, true) !== 2
  )
    throw new Error("Expected a ROFL v2 file");
  const headerEnd = 15 + bytes[14];
  const build = text.decode(bytes.subarray(15, headerEnd)).replace(/\0+$/, "");
  const protocol = Array.from(bytes.subarray(6, 14), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  if (build !== BUILD || protocol !== PROTOCOL)
    throw new Error(
      `Unsupported build/protocol: ${build} / ${protocol}. This spike supports only ${BUILD} / ${PROTOCOL}.`,
    );
  const metaLength = view.getUint32(bytes.length - 4, true);
  const metaStart = bytes.length - 4 - metaLength;
  const end = metaStart - 256;
  if (metaLength > 4 * 1024 * 1024 || end < headerEnd)
    throw new Error("Invalid metadata bounds");
  const metadata = JSON.parse(
    text.decode(bytes.subarray(metaStart, bytes.length - 4)),
  );
  const roster = JSON.parse(metadata.statsJson).map((p) => ({
    champion: p.SKIN,
    team: Number(p.TEAM),
  }));
  const events = [],
    histogram = {},
    movementPayloads = [],
    castTimes = [],
    animations = [];
  const gameplayPackets = [];
  let chunks = 0,
    blocks = 0,
    movementPackets = 0;
  let expandedBytes = 0;
  for (let cursor = headerEnd; cursor < end;) {
    if (cursor + 17 > end) throw new Error("Truncated chunk header");
    const chunkId = view.getUint32(cursor, true);
    const stream = view.getUint32(cursor + 5, true) >>> 24;
    const rawSize = view.getUint32(cursor + 9, true);
    const compressedSize = view.getUint32(cursor + 13, true);
    const size = compressedSize || rawSize;
    cursor += 17;
    if (rawSize > 64 * 1024 * 1024 || cursor + size > end)
      throw new Error("Invalid chunk size");
    expandedBytes += rawSize;
    if (expandedBytes > 1024 * 1024 * 1024 || ++chunks > 100000)
      throw new Error("Replay exceeds spike resource limits");
    const stored = bytes.subarray(cursor, cursor + size);
    cursor += size;
    if (stream !== 1 && !(collectGameplay && stream === 2)) continue;
    const body = compressedSize
      ? decompress(stored, new Uint8Array(rawSize))
      : stored;
    if (body.length !== rawSize)
      throw new Error("Chunk decompression length mismatch");
    const data = new DataView(body.buffer, body.byteOffset, body.byteLength);
    let offset = 0,
      timestamp = 0,
      opcode = 0,
      param = 0;
    const requireBytes = (n) => {
      if (offset + n > body.length)
        throw new Error(`Truncated block in chunk ${chunkId}`);
    };
    while (offset < body.length) {
      const blockOffset = offset;
      const marker = body[offset++];
      requireBytes(marker & 128 ? 1 : 4);
      if (marker & 128) timestamp += body[offset++] * 0.001;
      else {
        timestamp = data.getFloat32(offset, true);
        offset += 4;
      }
      if (!Number.isFinite(timestamp) || timestamp < 0)
        throw new Error("Invalid block timestamp");
      requireBytes(marker & 16 ? 1 : 4);
      let length;
      if (marker & 16) length = body[offset++];
      else {
        length = data.getUint32(offset, true);
        offset += 4;
      }
      if (!(marker & 64)) {
        requireBytes(2);
        opcode = data.getUint16(offset, true);
        offset += 2;
      }
      requireBytes(marker & 32 ? 1 : 4);
      if (marker & 32) param = (param + body[offset++]) >>> 0;
      else {
        param = data.getUint32(offset, true);
        offset += 4;
      }
      requireBytes(length);
      // Only creation records from the initial snapshot. Later snapshots must
      // not duplicate attacks or reset the running world's lifecycle.
      if (stream === 2) {
        if (timestamp === 0 && [107, 815, 550].includes(opcode))
          gameplayPackets.push({
            time: 0,
            opcode,
            param,
            chunkId,
            blockOffset,
            initial: true,
            payload: body.slice(offset, offset + length),
          });
        offset += length;
        continue;
      }
      histogram[opcode] = (histogram[opcode] || 0) + 1;
      if (
        collectGameplay &&
        (Array.isArray(collectGameplay)
          ? collectGameplay
          : GAMEPLAY_OPCODES
        ).includes(opcode)
      )
        gameplayPackets.push({
          time: timestamp,
          opcode,
          param,
          chunkId,
          blockOffset,
          payload: body.slice(offset, offset + length),
        });
      if (opcode === 0xc5) castTimes.push(timestamp);
      if (
        [35, 403, 928].includes(opcode) &&
        param >= 0x400000ae &&
        param < 0x400000b8
      ) {
        animations.push({
          ...decodeAnimation(body.subarray(offset, offset + length)),
          entityId: param,
          time: timestamp,
          opcode,
          chunkId,
          blockOffset,
        });
      }
      blocks++;
      if (opcode === 0x22c) {
        const decoded = movementBytes(body.subarray(offset, offset + length));
        const paths = movementPaths(decoded);
        movementPackets++;
        movementPayloads.push(decoded);
        for (const path of paths)
          events.push({
            ...path,
            time: timestamp,
            chunkId,
            blockOffset,
            opcode,
          });
      }
      offset += length;
    }
    progress({ chunks, blocks, movementPackets });
  }
  events.sort((a, b) => a.time - b.time);
  animations.sort((a, b) => a.time - b.time);
  return {
    build,
    protocol,
    roster,
    duration: metadata.gameLength / 1000,
    events,
    animations,
    histogram,
    chunks,
    blocks,
    movementPackets,
    movementPayloads,
    castTimes,
    gameplayPackets,
  };
}
