// Preserve the first failing original movement object for native-consumer work.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openReplay, replayChunks, replayBlocks } from "../transport.mjs";
import { StructuralDecoder } from "../structural-decoder.mjs";
import { createLatestFieldReader } from "../latest-fields.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const [assetsArg, replayArg, outputArg] = process.argv.slice(2);
if (!outputArg || process.argv.length !== 5)
  throw Error(
    "Usage: bun inspect-movement-speed-boundary.mjs <approved-public> <replay.rofl> <output.json>",
  );
const assets = resolve(assetsArg),
  inputs = {};
const sha = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
async function raw(file) {
  file = resolve(file);
  const bytes = await Bun.file(file).bytes(),
    hash = sha(bytes);
  if (inputs[file] && inputs[file] !== hash)
    throw Error("Movement control source changed");
  inputs[file] = hash;
  return bytes;
}
const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
await captureDirectSourceInputs([import.meta.path], raw);
const root = resolve(assets, "decoder-16.21-macos"),
  profile = decode(await raw(resolve(root, "profile.json"))),
  image = await raw(resolve(root, "image.bin")),
  constructors = await raw(resolve(root, "constructors.bin")),
  codecs = await raw(resolve(root, "field-codecs.json")),
  runtimeFile = resolve(assets, "vendor/unicorn_x86_candidate.mjs"),
  runtimeMeta = decode(await raw(runtimeFile.replace(/\.mjs$/, ".json")));
if (
  sha(image) !== profile.decoderImageSha256 ||
  sha(constructors) !== profile.constructorImageSha256 ||
  sha(codecs) !== profile.fieldCodecsSha256 ||
  sha(await raw(runtimeFile)) !== runtimeMeta.sha256
)
  throw Error("Exact original movement image/codecs/runtime required");
const replayBytes = await raw(replayArg),
  replay = openReplay(replayBytes.buffer);
if (
  replay.build !== profile.clientVersion ||
  replay.protocol !== profile.protocolDigest
)
  throw Error("Exact replay movement framing identity required");
const { default: createUnicorn } = await import(
  pathToFileURL(runtimeFile).href
);
const decoder = new StructuralDecoder(
  await createUnicorn(),
  profile,
  image,
  constructors,
);
const fields = createLatestFieldReader(profile, decode(codecs));
let sequence = 0,
  packets = 0,
  records = 0,
  boundary = null;
try {
  outer: for (const chunk of replayChunks(replay, (bytes) =>
    Bun.zstdDecompressSync(bytes),
  )) {
    if (![1, 2].includes(chunk.stream)) continue;
    for (const block of replayBlocks(chunk)) {
      const transportSequence = sequence++;
      if (![649, 657].includes(block.opcode)) continue;
      const observation = decoder.observePacket(
        block.opcode,
        block.payload,
        block.param,
        { captureMemory: true },
      );
      if (!observation.complete)
        throw Error("Original movement reader did not consume complete packet");
      packets++;
      try {
        records += fields.movement(observation, "signed8").length;
      } catch (error) {
        boundary = {
          opcode: block.opcode,
          time: block.time,
          param: block.param,
          stream: chunk.stream,
          chunkId: chunk.chunkId,
          blockOffset: block.blockOffset,
          transportSequence,
          error: {
            name: error.name,
            message: error.message,
            details: error.details ?? null,
          },
          payloadHex: Buffer.from(block.payload).toString("hex"),
          objectHex: Buffer.from(observation.object).toString("hex"),
          heapHex: Buffer.from(observation.heap).toString("hex"),
        };
        break outer;
      }
    }
  }
} finally {
  decoder.close();
}
for (const [file, hash] of Object.entries(inputs))
  if (sha(await Bun.file(file).bytes()) !== hash)
    throw Error("Movement boundary input changed");
await Bun.write(
  resolve(outputArg),
  JSON.stringify(
    {
      schema: 1,
      kind: "original-movement-parser-boundary",
      build: replay.build,
      protocol: replay.protocol,
      replaySha256: sha(replayBytes),
      duration: replay.duration,
      decoderImageSha256: profile.decoderImageSha256,
      inputs,
      packets,
      records,
      boundary,
      scope: {
        originalReaderExecuted: true,
        originalMovementConsumerExecuted: false,
        fullReplaySemantics: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    packets,
    records,
    boundary: boundary
      ? {
          ...boundary,
          payloadHex: undefined,
          objectHex: undefined,
          heapHex: undefined,
        }
      : null,
  }),
);
