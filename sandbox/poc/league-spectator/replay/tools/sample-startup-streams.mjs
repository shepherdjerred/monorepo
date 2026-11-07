// Research-only candidate framing for startup streams 3/4. Public transport
// inspection still treats them as opaque until their contract is established.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openReplay, replayChunks, replayBlocks } from "../transport.mjs";
const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  installation = await Bun.file(`${cache}/latest-installation.json`).json(),
  bytes = await Bun.file(installation.replay.file).bytes(),
  sha = (b) => new Bun.CryptoHasher("sha256").update(b).digest("hex"),
  replay = openReplay(bytes.buffer),
  chunks = [],
  packets = {};
if (
  sha(bytes) !== installation.replay.sha256 ||
  replay.build !== "16.21.829.8620" ||
  replay.protocol !== "20e09df23c66b85e"
)
  throw Error("Matching pinned startup replay required");
const { decompress } = await import(
  pathToFileURL(`${cache}/public/vendor/fzstd.mjs`).href
);
for (const chunk of replayChunks(replay, decompress)) {
  if (![3, 4].includes(chunk.stream)) continue;
  const blocks = [];
  for (const block of replayBlocks(chunk)) {
    const key = `${chunk.stream}:${chunk.chunkId}:${block.blockOffset}`,
      end = block.payload.byteOffset - chunk.body.byteOffset;
    packets[key] = {
      opcode: block.opcode,
      param: block.param,
      time: block.time,
      stream: chunk.stream,
      chunkId: chunk.chunkId,
      blockOffset: block.blockOffset,
      payloadHex: Buffer.from(block.payload).toString("hex"),
    };
    blocks.push({
      headerHex: Buffer.from(
        chunk.body.subarray(block.blockOffset, end),
      ).toString("hex"),
      time: block.time,
      opcode: block.opcode,
      param: block.param,
      length: block.payload.length,
    });
  }
  chunks.push({
    stream: chunk.stream,
    chunkId: chunk.chunkId,
    bodySha256: sha(chunk.body),
    blocks,
  });
}
const shared = {
  schema: 1,
  build: replay.build,
  protocol: replay.protocol,
  replaySha256: sha(bytes),
  sources: {
    "transport.mjs": sha(
      await Bun.file(resolve(import.meta.dir, "../transport.mjs")).bytes(),
    ),
    "tools/sample-startup-streams.mjs": sha(
      await Bun.file(import.meta.path).bytes(),
    ),
  },
  scope: {
    startupStreamFramingCandidate: true,
    semanticFieldsVerified: false,
    mainViewerIntegrated: false,
  },
};
await Bun.write(
  `${cache}/research/startup-streams-input.json`,
  JSON.stringify({ ...shared, packets }, null, 2),
);
await Bun.write(
  `${cache}/research/startup-streams-framing-input.json`,
  JSON.stringify({ ...shared, endTime: 0, chunks }, null, 2),
);
console.log(
  JSON.stringify({
    chunks: chunks.length,
    packets: Object.values(packets).map(({ payloadHex, ...p }) => ({
      ...p,
      bytes: payloadHex.length / 2,
    })),
  }),
);
