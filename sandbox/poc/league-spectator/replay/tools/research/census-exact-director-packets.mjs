import { writeFile } from "node:fs/promises";
import { zstdDecompressSync } from "node:zlib";
import {
  openReplay,
  replayPacketEnvelopes,
} from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/transport.mjs";

const [outputPath, ...replayPaths] = process.argv.slice(2);
if (!outputPath || !replayPaths.length) {
  throw new Error(
    "Usage: bun census-exact-director-packets.mjs OUTPUT REPLAY...",
  );
}

const build = "16.23.840.6595";
const protocol = "8bbfcd5af2bc92db";
// An original function near the directed-camera subsystem (x86-64 RVA
// 0x7a2490) constructs this opcode. A census cannot assign its semantics.
const cameraOpcode = 0x39f;
const replays = [];
for (const replayPath of replayPaths) {
  const buffer = await Bun.file(replayPath).arrayBuffer();
  const replay = openReplay(buffer);
  if (replay.build !== build || replay.protocol !== protocol) {
    throw new Error(`Expected replay build/protocol ${build}/${protocol}`);
  }

  const streams = {};
  const cameraMessages = {};
  let previousChunkOffset = -1;
  let opcode;
  for (const packet of replayPacketEnvelopes(replay, (input, target) =>
    zstdDecompressSync(input, { maxOutputLength: target.byteLength }),
  )) {
    const stream = (streams[packet.stream] ??= { chunks: 0, records: 0 });
    stream.records++;
    if (packet.chunkOffset !== previousChunkOffset) {
      stream.chunks++;
      previousChunkOffset = packet.chunkOffset;
      opcode = undefined;
    }
    opcode = packet.explicitOpcode ?? opcode;
    if (opcode === cameraOpcode) {
      cameraMessages[packet.stream] = (cameraMessages[packet.stream] ?? 0) + 1;
    }
  }
  replays.push({
    sha256: new Bun.CryptoHasher("sha256").update(buffer).digest("hex"),
    declaredChunkCount: replay.declaredChunkCount,
    streams,
    cameraMessages,
  });
}

await writeFile(
  outputPath,
  JSON.stringify({ build, protocol, cameraOpcode, replays }, null, 2) + "\n",
  { flag: "wx" },
);
