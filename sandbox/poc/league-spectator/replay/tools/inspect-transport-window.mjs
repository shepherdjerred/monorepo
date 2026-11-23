import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openReplay, replayChunks, replayBlocks } from "../transport.mjs";
import { sha256 } from "../structural-comparison.mjs";

const [replayPath, assetRoot, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-transport-window.mjs <replay.rofl> <exact-public-assets> <output.json>",
  );
const replayBytes = await Bun.file(replayPath).bytes(),
  replay = openReplay(replayBytes.buffer),
  vendorPath = resolve(assetRoot, "vendor/fzstd.mjs"),
  { decompress } = await import(pathToFileURL(vendorPath).href),
  streams = {},
  tailPackets = [],
  tailOpcodes = {};
let count = 0,
  recordedEnd = 0,
  tailCount = 0;
for (const chunk of replayChunks(replay, decompress)) {
  if (!streams[chunk.stream])
    streams[chunk.stream] = { packets: 0, chunks: 0, lastTime: 0 };
  const stream = streams[chunk.stream];
  stream.chunks++;
  for (const block of replayBlocks(chunk)) {
    count++;
    stream.packets++;
    stream.lastTime = Math.max(stream.lastTime, block.time);
    recordedEnd = Math.max(recordedEnd, block.time);
    if (block.time > replay.duration) {
      tailCount++;
      tailOpcodes[block.opcode] = (tailOpcodes[block.opcode] ?? 0) + 1;
      if (tailPackets.length < 32)
        tailPackets.push({
          opcode: block.opcode,
          time: block.time,
          stream: chunk.stream,
          chunkId: chunk.chunkId,
          blockOffset: block.blockOffset,
          param: block.param,
          payloadBytes: block.payload.length,
          payloadSha256: await sha256(block.payload),
        });
    }
  }
}
const result = {
  status: "observed",
  replaySha256: await sha256(replayBytes),
  sourceVendorSha256: await sha256(await Bun.file(vendorPath).bytes()),
  build: replay.build,
  protocol: replay.protocol,
  declaredDurationSeconds: replay.duration,
  originalRecordedTransportEndSeconds: recordedEnd,
  transportPackets: count,
  streams,
  tailCount,
  tailOpcodes,
  tailPackets,
  tailExamplesTruncated: tailCount > tailPackets.length,
  declaredMilliseconds: replay.duration * 1000,
  roundedRecordedMilliseconds: Math.round(recordedEnd * 1000),
  sameMillisecondAtRecordedEnd:
    Math.round(recordedEnd * 1000) === replay.duration * 1000,
  scope:
    "Original complete transport timestamps/counts; no native footer-rounding rule or new semantic coverage inferred",
};
await Bun.write(outputPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
