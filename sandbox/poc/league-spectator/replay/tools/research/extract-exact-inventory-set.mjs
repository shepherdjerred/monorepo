import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { zstdDecompressSync } from "node:zlib";
import { replayTimedPacketEnvelopes } from "../../replay-packet-clock.mjs";
import { openReplay, replayPacketEnvelopes } from "../../transport.mjs";

const { values, positionals } = parseArgs({
  options: {
    all: { type: "boolean" },
    current: { type: "boolean" },
    "replay-sha256": { type: "string" },
    "scene-sha256": { type: "string" },
  },
  allowPositionals: true,
});
const [replayPath, evidencePath, outputPath] = positionals;
const replayPin = values["replay-sha256"];
const scenePin = values["scene-sha256"];
const sha256Pattern = /^[a-f0-9]{64}$/;
if (
  positionals.length !== 3 ||
  !replayPath ||
  !evidencePath ||
  !outputPath ||
  (values.current
    ? !values.all ||
      !sha256Pattern.test(replayPin) ||
      !sha256Pattern.test(scenePin)
    : replayPin !== undefined || scenePin !== undefined)
)
  throw Error(
    "Usage: bun extract-exact-inventory-set.mjs REPLAY GOLD_TRACKS OUTPUT [--all] | --current --all --replay-sha256 SHA --scene-sha256 SHA REPLAY BOUND_SCENE OUTPUT",
  );
const sha256 = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const channels = new Set([190, 226, 248, 415, 797, 840, 1143, 1214]);
const goldDigests = new Map([
  [
    "cea604f9944cb8ca433a0655d742e0b741ae4477e0c7100b59a25b3221562668",
    "df874b09c242ab8b22b111d9516b482a309bb1bd0c25784daef660ef0ce44273",
  ],
  [
    "d7cabb0b7ba965f317863d128238847a0b9b0e4cc0cdbcfa3077c537b10fdf2b",
    "cf3b56a8b3908dc5bf1f15395f1140d57ea10412b1a1940942944f1301b239e6",
  ],
]);
const bytes = await Bun.file(replayPath).arrayBuffer();
const replay = openReplay(bytes);
const replaySha256 = sha256(bytes);
const evidenceBytes = await Bun.file(evidencePath).arrayBuffer();
const evidenceSha256 = sha256(evidenceBytes);
const evidence = JSON.parse(
  new TextDecoder("utf-8", { fatal: true }).decode(evidenceBytes),
);
if (
  replay.protocol !== "8bbfcd5af2bc92db" ||
  (values.current
    ? replay.build !== "16.23.841.8428" ||
      replaySha256 !== replayPin ||
      evidenceSha256 !== scenePin ||
      evidence.identity.replaySha256 !== replaySha256 ||
      evidence.identity.build !== replay.build ||
      evidence.identity.protocol !== replay.protocol ||
      evidence.identity.durationMilliseconds !== replay.durationMilliseconds ||
      evidence.identity.participantCount !== 10
    : replay.build !== "16.23.840.6595" ||
      goldDigests.get(replaySha256) !== evidenceSha256)
)
  throw Error("Expected a pinned exact replay and its corresponding evidence");
const roster = values.current ? evidence.participants : evidence.tracks;
const participants = new Set(roster.map(({ participantId }) => participantId));
if (
  values.current &&
  (participants.size !== 10 ||
    roster.length !== 10 ||
    [...participants].some(
      (id) => !Number.isInteger(id) || id < 1 || id > 0xffffffff,
    ))
)
  throw Error("Current inventory requires ten bound champion contexts");
const spends = [];
for (const { participantId, gold } of values.current ? [] : evidence.tracks) {
  for (let i = 1; i < gold.length; i++) {
    const [timeSeconds, after] = gold[i];
    const before = gold[i - 1][1];
    if (after < before)
      spends.push({ participantId, timeSeconds, before, after });
  }
}

const decompress = (input, output) =>
  zstdDecompressSync(input, { maxOutputLength: output.length });
let opcode, context;
const rows = [];
const streamCounts = {};
const rosterOpcodesByStream = {};
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
  if (participants.has(context)) {
    const stream = (rosterOpcodesByStream[packet.stream] ??= {});
    stream[opcode] = (stream[opcode] ?? 0) + 1;
  }
  if (values.all ? !channels.has(opcode) : opcode !== 840) continue;
  if (values.current && !participants.has(context)) continue;
  streamCounts[packet.stream] = (streamCounts[packet.stream] ?? 0) + 1;
  rows.push({
    context,
    stream: packet.stream,
    timeSeconds: packet.timeSeconds,
    chunkOffset: packet.chunkOffset,
    blockOffset: packet.blockOffset,
    body: Buffer.from(packet.payload).toString("hex"),
    ...(values.all ? { opcode, secondTimeBits: packet.secondTimeBits } : {}),
  });
}
await writeFile(
  outputPath,
  JSON.stringify({
    build: replay.build,
    protocol: replay.protocol,
    replaySha256,
    ...(values.current
      ? { sceneSha256: evidenceSha256 }
      : { goldSha256: evidenceSha256 }),
    participants: [...participants],
    spends,
    streamCounts,
    rosterOpcodesByStream,
    rows,
  }) + "\n",
  { flag: "wx" },
);
