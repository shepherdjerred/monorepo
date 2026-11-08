// ROFL v2 transport only. Gameplay opcodes and payloads remain build-specific.
const decoder = new TextDecoder("utf-8", { fatal: true });
const layouts = [
  {
    build: "16.14.794.5912",
    protocol: "509c49fd988fca11",
    chunkHeaderBytes: 17,
    paramDeltaMode: "unsigned8",
    timeDeltaMode: "float64",
  },
  {
    build: "16.21.829.8620",
    protocol: "20e09df23c66b85e",
    chunkHeaderBytes: 18,
    compressionTag: 4,
    paramDeltaMode: "signed8",
    timeDeltaMode: "float32",
  },
];

export function openReplay(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (
    bytes.length < 32 ||
    decoder.decode(bytes.subarray(0, 4)) !== "RIOT" ||
    view.getUint16(4, true) !== 2
  )
    throw Error("Expected a ROFL v2 file");
  const headerEnd = 15 + bytes[14];
  if (headerEnd > bytes.length - 260) throw Error("Truncated replay header");
  const build = decoder
    .decode(bytes.subarray(15, headerEnd))
    .replace(/\0+$/, "");
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(build)) throw Error("Invalid replay build");
  const protocol = Array.from(bytes.subarray(6, 14), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const metaLength = view.getUint32(bytes.length - 4, true);
  const metaStart = bytes.length - 4 - metaLength;
  const end = metaStart - 256;
  if (metaLength > 4 * 1024 * 1024 || metaLength === 0 || end < headerEnd)
    throw Error("Invalid metadata bounds");
  const metadata = JSON.parse(
    decoder.decode(bytes.subarray(metaStart, bytes.length - 4)),
  );
  const participants = JSON.parse(metadata.statsJson);
  if (
    !Array.isArray(participants) ||
    !Number.isFinite(metadata.gameLength) ||
    metadata.gameLength < 0
  )
    throw Error("Invalid replay metadata");
  // Metadata identities are not network entity identities. Binding requires a decoder.
  const roster = participants.map((p) => {
    const team = Number(p.TEAM);
    if (typeof p.SKIN !== "string" || !Number.isInteger(team))
      throw Error("Invalid participant metadata");
    return { champion: p.SKIN, team };
  });
  return {
    bytes,
    view,
    headerEnd,
    end,
    build,
    protocol,
    roster,
    playerIdentities: participants.map((p) => {
      const gameName = p.RIOT_ID_GAME_NAME,
        tagLine = p.RIOT_ID_TAG_LINE;
      if (gameName === undefined && tagLine === undefined) return null;
      if (
        typeof gameName !== "string" ||
        typeof tagLine !== "string" ||
        gameName.length < 1 ||
        gameName.length > 128 ||
        tagLine.length < 1 ||
        tagLine.length > 32 ||
        /[\u0000-\u001f\u007f]/.test(gameName + tagLine)
      )
        throw Error("Invalid replay player identity metadata");
      return { gameName, tagLine };
    }),
    duration: metadata.gameLength / 1000,
  };
}

export function* replayChunks(replay, decompress, { streams } = {}) {
  if (
    streams !== undefined &&
    (!Array.isArray(streams) ||
      streams.length === 0 ||
      streams.length > 256 ||
      new Set(streams).size !== streams.length ||
      streams.some(
        (stream) => !Number.isInteger(stream) || stream < 0 || stream > 255,
      ))
  )
    throw Error("Invalid replay stream selection");
  const selectedStreams = streams === undefined ? null : new Set(streams);
  const { bytes, view, headerEnd, end } = replay;
  const layout = layouts.find(
    (p) => p.build === replay.build && p.protocol === replay.protocol,
  );
  if (!layout)
    throw Error(
      `Unsupported transport build/protocol: ${replay.build} / ${replay.protocol}`,
    );
  let cursor = headerEnd,
    expandedBytes = 0,
    count = 0;
  while (cursor < end) {
    if (cursor + layout.chunkHeaderBytes > end)
      throw Error("Truncated chunk header");
    const chunkId = view.getUint32(cursor, true);
    const stream = view.getUint32(cursor + 5, true) >>> 24;
    const rawSize = view.getUint32(cursor + 9, true);
    const compressedSize = view.getUint32(cursor + 13, true);
    const size = compressedSize || rawSize;
    const compressionTag =
      layout.chunkHeaderBytes === 18 ? bytes[cursor + 17] : null;
    if (compressionTag !== null && compressionTag !== layout.compressionTag)
      throw Error(`Unsupported chunk compression tag ${compressionTag}`);
    cursor += layout.chunkHeaderBytes;
    if (rawSize > 64 * 1024 * 1024 || cursor + size > end)
      throw Error("Invalid chunk size");
    expandedBytes += rawSize;
    if (expandedBytes > 1024 * 1024 * 1024 || ++count > 100000)
      throw Error("Replay exceeds transport resource limits");
    const stored = bytes.subarray(cursor, cursor + size);
    cursor += size;
    // Header/resource bounds still cover the entire replay. A selected stream
    // does not require decompression of unrelated packet bodies.
    if (selectedStreams && !selectedStreams.has(stream)) continue;
    let body;
    try {
      body = compressedSize
        ? decompress(stored, new Uint8Array(rawSize))
        : stored;
    } catch (cause) {
      throw Error(`Chunk ${chunkId}, stream ${stream}: decompression failed`, {
        cause,
      });
    }
    if (body.length !== rawSize)
      throw Error("Chunk decompression length mismatch");
    yield {
      chunkId,
      stream,
      rawSize,
      compressedSize,
      compressionTag,
      body,
      paramDeltaMode: layout.paramDeltaMode,
      timeDeltaMode: layout.timeDeltaMode,
    };
  }
}

export function* replayBlocks(chunk) {
  const { chunkId, stream, body } = chunk;
  const data = new DataView(body.buffer, body.byteOffset, body.byteLength);
  if (
    !["signed8", "unsigned8"].includes(chunk.paramDeltaMode) ||
    !["float32", "float64"].includes(chunk.timeDeltaMode)
  )
    throw Error("Explicit transport delta rules required");
  let offset = 0,
    timestamp = 0,
    opcode = 0,
    param = 0;
  const need = (n) => {
    if (offset + n > body.length)
      throw Error(`Truncated block in chunk ${chunkId}`);
  };
  while (offset < body.length) {
    const blockOffset = offset;
    const marker = body[offset++];
    need(marker & 128 ? 1 : 4);
    if (marker & 128) {
      const delta = body[offset++];
      timestamp =
        chunk.timeDeltaMode === "float32"
          ? Math.fround(timestamp + Math.fround(delta * Math.fround(0.001)))
          : timestamp + delta * 0.001;
    } else {
      timestamp = data.getFloat32(offset, true);
      offset += 4;
    }
    if (!Number.isFinite(timestamp) || timestamp < 0)
      throw Error("Invalid block timestamp");
    need(marker & 16 ? 1 : 4);
    let length;
    if (marker & 16) length = body[offset++];
    else {
      length = data.getUint32(offset, true);
      offset += 4;
    }
    if (!(marker & 64)) {
      need(2);
      opcode = data.getUint16(offset, true);
      offset += 2;
    }
    need(marker & 32 ? 1 : 4);
    if (marker & 32) {
      const delta =
        chunk.paramDeltaMode === "signed8"
          ? data.getInt8(offset)
          : body[offset];
      offset++;
      param = (param + delta) >>> 0;
    } else {
      param = data.getUint32(offset, true);
      offset += 4;
    }
    need(length);
    yield {
      time: timestamp,
      opcode,
      param,
      chunkId,
      stream,
      blockOffset,
      payload: body.subarray(offset, offset + length),
    };
    offset += length;
  }
}

export function inspectTransport(buffer, decompress, onBlock = () => {}) {
  const replay = openReplay(buffer);
  const streams = {},
    opcodes = {};
  let chunks = 0,
    blocks = 0,
    expandedBytes = 0;
  for (const chunk of replayChunks(replay, decompress)) {
    chunks++;
    expandedBytes += chunk.rawSize;
    const summary = (streams[chunk.stream] ??= {
      chunks: 0,
      blocks: 0,
      expandedBytes: 0,
    });
    summary.chunks++;
    summary.expandedBytes += chunk.rawSize;
    // Only these stream grammars have been established; retain other streams as opaque.
    if (chunk.stream !== 1 && chunk.stream !== 2) continue;
    for (const block of replayBlocks(chunk)) {
      blocks++;
      summary.blocks++;
      if (chunk.stream === 1)
        opcodes[block.opcode] = (opcodes[block.opcode] ?? 0) + 1;
      onBlock(block);
    }
  }
  const { build, protocol, roster, duration } = replay;
  return {
    build,
    protocol,
    roster,
    duration,
    chunks,
    blocks,
    expandedBytes,
    streams,
    opcodes,
    gameplayDecoded: false,
  };
}
