import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import { replayTimedPacketEnvelopes } from "../../replay-packet-clock.mjs";
import { openReplay, replayPacketEnvelopes } from "../../transport.mjs";

const classicLevelCap = 18;
const rotateByte = (value, shift) =>
  ((value << shift) | (value >>> (8 - shift))) & 0xff;

function readClassicLevelCap(payload) {
  // Reader 0x11dc7c0 starts with a three-bit selector after its context
  // header. ROFL carries the context in the envelope, outside this body.
  const selector = payload[0] & 7;
  if (payload.length !== (selector < 4 ? 1 : 2))
    throw Error("Invalid recorded champion level-cap body");
  // Selector 3 writes the selector itself. The other short cases write literals.
  const encoded =
    selector < 4 ? [0x43, 0x83, 0xc2, 0x03][selector] : payload[1];
  // Handler 0x101a60 invokes the original setter at 0x186ae0.
  const override = (rotateByte(rotateByte(encoded, 4) ^ 0xff, 6) + 14) & 0xff;
  return override || classicLevelCap;
}

export function extractRecordedChampionLevelCaps(
  rawReplay,
  participantIds,
  onPacket,
) {
  const ids = [...participantIds];
  const participants = new Set(ids);
  if (
    ids.length !== 10 ||
    participants.size !== ids.length ||
    ids.some((id) => !Number.isInteger(id) || id < 1 || id > 0xffffffff)
  )
    throw Error("Ten independently bound replay champion identities required");
  const replay = openReplay(
    rawReplay instanceof ArrayBuffer
      ? rawReplay
      : Uint8Array.from(rawReplay).buffer,
  );
  if (
    replay.build !== "16.23.840.6595" ||
    replay.protocol !== "8bbfcd5af2bc92db"
  )
    throw Error("Wrong archived champion level-cap protocol");
  const decompress = (bytes, output) =>
    zstdDecompressSync(bytes, { maxOutputLength: output.length });
  const tracks = new Map();
  let opcode;
  let context = 0;
  for (const packet of replayTimedPacketEnvelopes(
    replayPacketEnvelopes(replay, decompress),
  )) {
    if (packet.blockOffset === 0) {
      opcode = undefined;
      context = 0;
    }
    opcode = packet.explicitOpcode ?? opcode;
    context =
      packet.marker & 32
        ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
        : packet.paramBits;
    if (opcode !== 652 || (packet.stream !== 1 && onPacket === undefined))
      continue;
    const champion = participants.has(context);
    const maxLevel = champion ? readClassicLevelCap(packet.payload) : undefined;
    onPacket?.({
      stream: packet.stream,
      participantId: context,
      champion,
      timeSeconds: packet.timeSeconds,
      chunkOffset: packet.chunkOffset,
      blockOffset: packet.blockOffset,
      marker: packet.marker,
      payload: Buffer.from(packet.payload).toString("hex"),
      maxLevel,
    });
    if (packet.stream !== 1 || maxLevel === undefined) continue;
    const points = tracks.get(context) ?? [];
    // Physical envelope order decides tied observations for the same actor.
    if (points.at(-1)?.[0] === packet.timeSeconds) points.pop();
    if ((points.at(-1)?.[1] ?? classicLevelCap) !== maxLevel)
      points.push([packet.timeSeconds, maxLevel]);
    if (points.length > 0) tracks.set(context, points);
    else tracks.delete(context);
  }
  return tracks;
}

if (import.meta.main) {
  const [replayFile, sceneFile, output] = process.argv.slice(2);
  if (!replayFile || !sceneFile || !output || process.argv.length !== 5)
    throw Error(
      "Usage: bun recorded-champion-level-cap.mjs <replay.rofl> <bound-scene.json> <packet-input.json>",
    );
  const raw = readFileSync(replayFile);
  const scene = JSON.parse(readFileSync(sceneFile, "utf8"));
  const identity = {
    replaySha256: createHash("sha256").update(raw).digest("hex"),
    build: "16.23.840.6595",
    protocol: "8bbfcd5af2bc92db",
  };
  for (const key of Object.keys(identity)) {
    if (scene.identity[key] !== identity[key])
      throw Error("Replay and independently bound scene identity differ");
  }
  const participantIds = scene.participants.map(
    ({ participantId }) => participantId,
  );
  const streamCounts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const rows = [];
  extractRecordedChampionLevelCaps(raw, participantIds, (row) => {
    if (!(row.stream in streamCounts))
      throw Error("Unexpected recorded level-cap stream");
    streamCounts[row.stream]++;
    if (row.champion) rows.push(row);
  });
  const controls = [];
  for (let selector = 0; selector < 8; selector++) {
    if (selector < 4) controls.push(readClassicLevelCap([selector]));
    else {
      for (let value = 0; value < 256; value++)
        controls.push(readClassicLevelCap([selector, value]));
    }
  }
  const controlSha256 = createHash("sha256")
    .update(Buffer.from(controls))
    .digest("hex");
  writeFileSync(
    output,
    JSON.stringify({
      identity,
      participantIds,
      streamCounts,
      rows,
      controlSha256,
    }) + "\n",
    { flag: "wx" },
  );
}
