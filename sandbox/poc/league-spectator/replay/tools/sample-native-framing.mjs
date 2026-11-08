// Retain original framing bytes for an independent execution of Riot's reader.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openReplay, replayChunks, replayBlocks } from "../transport.mjs";
import { sha256 } from "../structural-comparison.mjs";
const [replayPath, vendorPath, outputPath, endArg] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun sample-native-framing.mjs <replay.rofl> <fzstd.mjs> <output.json> [end-seconds]",
  );
const buffer = await Bun.file(replayPath).arrayBuffer(),
  replay = openReplay(buffer),
  endTime = endArg === undefined ? replay.duration : Number(endArg);
if (
  replay.build !== "16.21.829.8620" ||
  replay.protocol !== "20e09df23c66b85e" ||
  !Number.isFinite(endTime) ||
  endTime < 0 ||
  endTime > replay.duration
)
  throw Error("Unsupported native framing input");
const { decompress } = await import(pathToFileURL(resolve(vendorPath))),
  chunks = [];
let total = 0;
for (const chunk of replayChunks(replay, decompress)) {
  if (![1, 2].includes(chunk.stream)) continue;
  const blocks = [];
  for (const block of replayBlocks(chunk)) {
    if (block.time > endTime) break;
    const headerEnd = block.payload.byteOffset - chunk.body.byteOffset;
    blocks.push({
      headerHex: Buffer.from(
        chunk.body.subarray(block.blockOffset, headerEnd),
      ).toString("hex"),
      time: block.time,
      opcode: block.opcode,
      param: block.param,
      length: block.payload.length,
    });
  }
  if (blocks.length)
    chunks.push({ chunkId: chunk.chunkId, stream: chunk.stream, blocks });
  total += blocks.length;
}
await Bun.write(
  outputPath,
  JSON.stringify({
    schema: 1,
    build: replay.build,
    protocol: replay.protocol,
    replaySha256: await sha256(buffer),
    endTime,
    chunks,
  }),
);
console.log(JSON.stringify({ chunks: chunks.length, blocks: total, endTime }));
