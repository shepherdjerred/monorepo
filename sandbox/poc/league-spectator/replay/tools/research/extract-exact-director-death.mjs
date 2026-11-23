import { writeFile } from "node:fs/promises";
import { zstdDecompressSync } from "node:zlib";
import { openReplay, replayPacketEnvelopes } from "../../transport.mjs";

const [replayPath, outputPath] = process.argv.slice(2);
if (!replayPath || !outputPath)
  throw Error("Usage: bun extract-exact-director-death.mjs REPLAY OUTPUT");

const bytes = await Bun.file(replayPath).arrayBuffer();
const replay = openReplay(bytes);
const replaySha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
if (
  replay.build !== "16.23.840.6595" ||
  replay.protocol !== "8bbfcd5af2bc92db" ||
  replaySha256 !==
    "cea604f9944cb8ca433a0655d742e0b741ae4477e0c7100b59a25b3221562668"
)
  throw Error("Expected the independently verified long Renekton replay");

const decompress = (input, output) =>
  zstdDecompressSync(input, { maxOutputLength: output.length });
let context = 0;
let opcode;
let anchorBits;
let deltas = [];
let damage;
let retained;
for (const packet of replayPacketEnvelopes(replay, decompress)) {
  if (packet.stream !== 1) continue;
  if (packet.blockOffset === 0) {
    opcode = undefined;
    context = 0;
  }
  opcode = packet.explicitOpcode ?? opcode;
  context =
    packet.marker & 32
      ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
      : packet.paramBits;
  if (packet.marker & 128) {
    deltas.push(packet.firstTimeBits);
  } else {
    anchorBits = packet.firstTimeBits;
    deltas = [];
  }
  if (packet.chunkOffset !== 239723) continue;
  if (packet.blockOffset === 397296) {
    if (
      context !== 1073742164 ||
      opcode !== 530 ||
      packet.payload.length !== 17
    )
      throw Error("Recorded Sion damage packet disagrees with exact identity");
    damage = {
      context,
      opcode,
      blockOffset: packet.blockOffset,
      anchorBits,
      deltas: deltas.slice(),
      body: Buffer.from(packet.payload).toString("hex"),
    };
  }
  if (packet.blockOffset !== 406441) continue;
  if (context !== 1073742161 || opcode !== 1183 || packet.payload.length !== 33)
    throw Error("Recorded Renekton packet disagrees with exact event identity");
  if (!damage)
    throw Error("Missing the recorded damage packet near the elimination");
  retained = {
    build: replay.build,
    protocol: replay.protocol,
    replaySha256,
    stream: packet.stream,
    chunkOffset: packet.chunkOffset,
    blockOffset: packet.blockOffset,
    context,
    opcode,
    anchorBits,
    deltas,
    secondTimeBits: packet.secondTimeBits,
    body: Buffer.from(packet.payload).toString("hex"),
    damage,
  };
  break;
}
if (!retained) throw Error("Missing the verified Renekton elimination packet");
await writeFile(outputPath, JSON.stringify(retained, null, 2) + "\n", {
  flag: "wx",
});
