// ROFL v2 transport only. Gameplay opcodes and payloads remain build-specific.
import {
  getReplayContainerLayout,
  getReplayTransportLayout,
  normalizeGameBuild,
  readReplayChunkHeader,
} from "../../../domain/src/artifacts/replay-transport.mjs";
const decoder = new TextDecoder("utf-8", { fatal: true });
const packetRecordTypes = new Map([
  ["16.23.839.9929/8bbfcd5af2bc92db", [1, 2, 3]],
  ["16.23.840.6595/8bbfcd5af2bc92db", [1, 2, 3]],
]);

function readTwoTeamWinner(participants) {
  const blue = participants.filter((row) => Number(row.TEAM) === 100);
  const red = participants.filter((row) => Number(row.TEAM) === 200);
  if (participants.length !== 10 || blue.length !== 5 || red.length !== 5)
    return null;
  const won = ({ WIN }) => WIN === "Win";
  const lost = ({ WIN }) => WIN === "Fail" || WIN === "LeaverFail";
  if (blue.every(won) && red.every(lost)) return 100;
  if (red.every(won) && blue.every(lost)) return 200;
  return null;
}

export function openReplay(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (
    bytes.length < 32 ||
    decoder.decode(bytes.subarray(0, 4)) !== "RIOT" ||
    view.getUint16(4, true) !== 2
  )
    throw Error("Expected a ROFL v2 file");
  if (bytes[14] === 0 || bytes[14] > 64) throw Error("Invalid replay build");
  const headerEnd = 15 + bytes[14];
  if (headerEnd > bytes.length - 260) throw Error("Truncated replay header");
  const build = normalizeGameBuild(
    decoder.decode(bytes.subarray(15, headerEnd)).replace(/\0+$/, ""),
  );
  if (build === null) throw Error("Invalid replay build");
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
    winningTeam: readTwoTeamWinner(participants),
    participantSummonerIds: participants.map((p) => {
      if (p.SUMMONER_ID === undefined) return null;
      if (
        typeof p.SUMMONER_ID !== "string" ||
        !/^[1-9][0-9]{0,19}$/.test(p.SUMMONER_ID) ||
        BigInt(p.SUMMONER_ID) > 0xffffffffffffffffn
      )
        throw Error("Invalid replay participant summoner identity");
      return p.SUMMONER_ID;
    }),
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
    durationMilliseconds: metadata.gameLength,
    declaredChunkCount: [
      metadata.lastGameChunkId,
      metadata.lastKeyFrameId,
    ].every((id) => Number.isSafeInteger(id) && id >= 0)
      ? metadata.lastGameChunkId + metadata.lastKeyFrameId
      : null,
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
  const layout = getReplayTransportLayout(replay.build, replay.protocol);
  for (const {
    chunkOffset: _offset,
    storedChunkBytes: _bytes,
    ...chunk
  } of readReplayChunks(replay, decompress, layout, selectedStreams))
    yield chunk;
}

function chunkAt({ bytes, end }, layout, chunkOffset) {
  const bodyOffset = chunkOffset + layout.chunkHeaderBytes;
  if (bodyOffset > end) throw Error("Truncated chunk header");
  const { storedSize, ...header } = readReplayChunkHeader(
    bytes.subarray(chunkOffset, bodyOffset),
    layout,
  );
  if (bodyOffset + storedSize > end) throw Error("Invalid chunk size");
  return {
    ...header,
    chunkOffset,
    storedChunkBytes: layout.chunkHeaderBytes + storedSize,
    stored: bytes.subarray(bodyOffset, bodyOffset + storedSize),
  };
}

function expandChunk({ stored, ...chunk }, decompress) {
  const { rawSize, compressedSize, chunkId, stream } = chunk;
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
  return { ...chunk, body };
}

function* readReplayChunks(
  replay,
  decompress,
  layout,
  selectedStreams,
  cursor = replay.headerEnd,
) {
  const { end } = replay;
  let expandedBytes = 0,
    count = 0;
  while (cursor < end) {
    const chunk = chunkAt(replay, layout, cursor);
    cursor += chunk.storedChunkBytes;
    expandedBytes += chunk.rawSize;
    if (expandedBytes > 1024 * 1024 * 1024 || ++count > 100000)
      throw Error("Replay exceeds transport resource limits");
    // Header/resource bounds cover the scanned range. A selected stream
    // does not require decompression of unrelated packet bodies.
    if (selectedStreams && !selectedStreams.has(chunk.stream)) continue;
    yield {
      ...expandChunk(chunk, decompress),
      paramDeltaMode: layout.paramDeltaMode,
      timeDeltaMode: layout.timeDeltaMode,
    };
  }
}

function envelopeLayout(replay) {
  const { build, protocol, declaredChunkCount } = replay;
  const recordTypes = packetRecordTypes.get(`${build}/${protocol}`);
  if (!recordTypes)
    throw Error(
      `Unsupported packet envelope build/protocol: ${build} / ${protocol}`,
    );
  if (
    !Number.isSafeInteger(declaredChunkCount) ||
    declaredChunkCount <= 0 ||
    declaredChunkCount > 100000
  )
    throw Error("Invalid declared replay chunk count");
  return { recordTypes, layout: getReplayContainerLayout(build, protocol) };
}

// Recorded fields only. The marker preserves the time and parameter widths;
// callers must establish signedness, accumulation and clock meaning separately.
export function* replayPacketEnvelopes(replay, decompress) {
  const { layout, recordTypes } = envelopeLayout(replay);
  let chunkCount = 0;
  for (const chunk of readReplayChunks(replay, decompress, layout, null)) {
    if (++chunkCount > replay.declaredChunkCount)
      throw Error("Replay chunk count mismatch");
    yield* packetEnvelopes(chunk, recordTypes);
  }
  if (chunkCount !== replay.declaredChunkCount)
    throw Error("Replay chunk count mismatch");
}

export function* readReplayKeyframe(replay, entry, decompress) {
  const { layout, recordTypes } = envelopeLayout(replay);
  if (!entry) throw Error("Indexed keyframe entry is required");
  const {
    chunkOffset,
    storedChunkBytes,
    chunkId,
    timeSeconds,
    secondTimeBits,
  } = entry;
  if (
    !Number.isSafeInteger(chunkOffset) ||
    !Number.isSafeInteger(storedChunkBytes) ||
    chunkOffset < replay.headerEnd ||
    storedChunkBytes <= layout.chunkHeaderBytes ||
    storedChunkBytes > replay.end - chunkOffset ||
    !Number.isInteger(chunkId) ||
    chunkId < 0 ||
    chunkId > 0xffffffff ||
    !Number.isFinite(timeSeconds) ||
    timeSeconds < 0 ||
    !Number.isInteger(secondTimeBits) ||
    secondTimeBits < 0 ||
    secondTimeBits > 0xffffffff
  )
    throw Error("Invalid indexed keyframe range or identity");

  const chunk = chunkAt(replay, layout, chunkOffset);
  if (
    chunk.stream !== 2 ||
    chunk.chunkId !== chunkId ||
    chunk.storedChunkBytes !== storedChunkBytes
  )
    throw Error("Indexed keyframe header mismatch");

  const records = packetEnvelopes(expandChunk(chunk, decompress), recordTypes);
  const { value: first } = records.next();
  const clock = new DataView(new ArrayBuffer(4));
  if (!first) throw Error("Indexed keyframe boundary mismatch");
  clock.setUint32(0, first.firstTimeBits, true);
  if (
    first.marker & 128 ||
    first.explicitOpcode !== 1167 ||
    first.payload.length !== 2 ||
    !Object.is(clock.getFloat32(0, true), timeSeconds) ||
    first.secondTimeBits !== secondTimeBits
  )
    throw Error("Indexed keyframe boundary mismatch");
  yield first;
  yield* records;
}

// Use an entry built from these same original bytes. A partial read validates
// the selected keyframe and scanned suffix, while indexing validates the file.
export function* readReplayPacketsFromKeyframe(replay, entry, decompress) {
  const { layout, recordTypes } = envelopeLayout(replay);
  let nextOffset;
  for (const record of readReplayKeyframe(replay, entry, decompress)) {
    nextOffset ??= record.chunkOffset + record.storedChunkBytes;
    yield record;
  }
  for (const chunk of readReplayChunks(
    replay,
    decompress,
    layout,
    new Set([1]),
    nextOffset,
  ))
    yield* packetEnvelopes(chunk, recordTypes);
}

function* packetEnvelopes(
  { chunkId, stream, chunkOffset, storedChunkBytes, body },
  recordTypes,
) {
  const data = new DataView(body.buffer, body.byteOffset, body.byteLength);
  let offset = 0;
  const take = (size) => {
    const start = offset;
    offset += size;
    if (offset > body.length)
      throw Error(
        `Truncated packet envelope in chunk ${chunkId}, stream ${stream}`,
      );
    return start;
  };
  while (offset < body.length) {
    const blockOffset = offset;
    const marker = data.getUint8(take(1));
    if (!recordTypes.includes(marker & 15))
      throw Error(
        `Unsupported packet marker ${marker} in chunk ${chunkId}, stream ${stream}`,
      );
    const firstTimeBits =
      marker & 128 ? data.getUint8(take(1)) : data.getUint32(take(4), true);
    const secondTimeBits = data.getUint32(take(4), true);
    const payloadLength =
      marker & 16 ? data.getUint8(take(1)) : data.getUint32(take(4), true);
    const explicitOpcode = marker & 64 ? null : data.getUint16(take(2), true);
    const paramBits =
      marker & 32 ? data.getUint8(take(1)) : data.getUint32(take(4), true);
    const payloadOffset = take(payloadLength);
    yield {
      chunkId,
      stream,
      chunkOffset,
      storedChunkBytes,
      blockOffset,
      marker,
      firstTimeBits,
      secondTimeBits,
      explicitOpcode,
      paramBits,
      payload: body.subarray(payloadOffset, offset),
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
