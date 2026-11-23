// Bounded original-reader observations for a missing semantic consumer.
// Raw decoded objects/arenas do not constitute entity creation acceptance.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openReplay, replayChunks, replayBlocks } from "../transport.mjs";
import { StructuralDecoder } from "../structural-decoder.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const [assetsArg, replayArg, opcodesArg, outputArg] = process.argv.slice(2);
if (!outputArg)
  throw Error(
    "Usage: bun capture-original-packet-family.mjs <approved-public-assets> <exact-replay.rofl> <comma-separated-opcodes> <output.json>",
  );
const assets = resolve(assetsArg),
  inputs = {},
  sha = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
async function raw(file) {
  const key = resolve(file),
    bytes = await Bun.file(key).bytes();
  inputs[key] = sha(bytes);
  return bytes;
}
const json = async (file) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await raw(file)));
await captureDirectSourceInputs([import.meta.path], raw);
const root = resolve(assets, "decoder-16.21-macos"),
  profile = await json(resolve(root, "profile.json"));
const opcodes = new Set(opcodesArg.split(",").map(Number));
if (
  opcodes.size < 1 ||
  opcodes.size > 16 ||
  [...opcodes].some((id) => !Number.isInteger(id) || !profile.packets[id])
)
  throw Error("Bounded prepared original packet class list required");
const image = await raw(resolve(root, "image.bin")),
  constructors = await raw(resolve(root, "constructors.bin"));
const runtimePath = resolve(assets, "vendor/unicorn_x86_candidate.mjs"),
  runtimeMeta = await json(runtimePath.replace(/\.mjs$/, ".json"));
if (
  sha(image) !== profile.decoderImageSha256 ||
  sha(constructors) !== profile.constructorImageSha256 ||
  sha(await raw(runtimePath)) !== runtimeMeta.sha256
)
  throw Error("Original packet reader image/runtime identity differs");
const replayBytes = await raw(replayArg),
  replay = openReplay(replayBytes.buffer);
if (
  replay.build !== "16.21.829.8620" ||
  replay.protocol !== "20e09df23c66b85e" ||
  replay.build !== profile.clientVersion ||
  replay.protocol !== profile.protocolDigest
)
  throw Error("Exact admitted original packet framing/build required");
const { default: createUnicorn } = await import(
  pathToFileURL(runtimePath).href
);
const decoder = new StructuralDecoder(
    await createUnicorn(),
    profile,
    image,
    constructors,
  ),
  records = [];
let sequence = 0;
try {
  for (const chunk of replayChunks(replay, (bytes) =>
    Bun.zstdDecompressSync(bytes),
  )) {
    if (![1, 2].includes(chunk.stream)) continue;
    for (const block of replayBlocks(chunk)) {
      const transportSequence = sequence++;
      if (!opcodes.has(block.opcode)) continue;
      if (records.length >= 10000)
        throw Error(
          "Original packet capture exceeded its explicit record bound",
        );
      const observation = decoder.observePacket(
        block.opcode,
        block.payload,
        block.param,
        { captureMemory: true },
      );
      if (!observation.complete)
        throw Error("Original packet reader did not consume a complete object");
      records.push({
        opcode: block.opcode,
        time: block.time,
        param: block.param,
        stream: chunk.stream,
        chunkId: chunk.chunkId,
        blockOffset: block.blockOffset,
        transportSequence,
        entryRva: observation.entryRva,
        payloadHex: Buffer.from(block.payload).toString("hex"),
        objectHex: Buffer.from(observation.object).toString("hex"),
        heapHex: Buffer.from(observation.heap).toString("hex"),
      });
    }
  }
} finally {
  decoder.close();
}
for (const [file, digest] of Object.entries(inputs))
  if (sha(await Bun.file(file).bytes()) !== digest)
    throw Error("Original capture input changed: " + file);
await Bun.write(
  outputArg,
  JSON.stringify(
    {
      schema: 1,
      kind: "original-packet-family-capture",
      build: replay.build,
      protocol: replay.protocol,
      replaySha256: sha(replayBytes),
      duration: replay.duration,
      decoderImageSha256: profile.decoderImageSha256,
      constructorImageSha256: profile.constructorImageSha256,
      opcodes: [...opcodes],
      records,
      inputs,
      scope: {
        originalReaderExecuted: true,
        originalSemanticConsumerExecuted: false,
        acceptedWorldEntities: false,
        nativeSpectatorEquivalent: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output: resolve(outputArg),
    records: records.length,
    opcodes: [...opcodes],
  }),
);
