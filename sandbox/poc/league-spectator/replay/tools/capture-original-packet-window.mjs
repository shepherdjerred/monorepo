// An explicit bounded diagnostic window, separate from immutable full-family
// proof receipts. Transport ordinals still count every original gameplay packet.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openReplay, replayChunks, replayBlocks } from "../transport.mjs";
import { StructuralDecoder } from "../structural-decoder.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const [assetsArg, replayArg, opcodesArg, endArg, outputArg] =
  process.argv.slice(2);
const endSeconds = Number(endArg);
if (
  !outputArg ||
  process.argv.length !== 7 ||
  !Number.isFinite(endSeconds) ||
  endSeconds <= 0 ||
  endSeconds > 7200
)
  throw Error(
    "Usage: bun capture-original-packet-window.mjs <approved-public-assets> <exact-replay.rofl> <comma-separated-opcodes> <through-seconds> <output.json>",
  );
const assets = resolve(assetsArg),
  inputs = {};
const sha = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
async function raw(file) {
  const key = resolve(file),
    bytes = await Bun.file(key).bytes(),
    digest = sha(bytes);
  if (inputs[key] && inputs[key] !== digest)
    throw Error("Original window capture input changed");
  inputs[key] = digest;
  return bytes;
}
const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
await captureDirectSourceInputs([import.meta.path], raw);
const root = resolve(assets, "decoder-16.21-macos"),
  profile = decode(await raw(resolve(root, "profile.json")));
const opcodes = new Set(opcodesArg.split(",").map(Number));
if (
  !opcodes.size ||
  opcodes.size > 16 ||
  [...opcodes].some((id) => !Number.isInteger(id) || !profile.packets[id])
)
  throw Error("Bounded prepared packet classes required");
const image = await raw(resolve(root, "image.bin")),
  constructors = await raw(resolve(root, "constructors.bin")),
  runtimePath = resolve(assets, "vendor/unicorn_x86_candidate.mjs"),
  runtime = decode(await raw(runtimePath.replace(/\.mjs$/, ".json")));
if (
  sha(image) !== profile.decoderImageSha256 ||
  sha(constructors) !== profile.constructorImageSha256 ||
  sha(await raw(runtimePath)) !== runtime.sha256
)
  throw Error("Exact original reader image/runtime required");
const replayBytes = await raw(replayArg),
  replay = openReplay(replayBytes.buffer);
if (
  replay.build !== "16.21.829.8620" ||
  replay.protocol !== "20e09df23c66b85e" ||
  replay.build !== profile.clientVersion ||
  replay.protocol !== profile.protocolDigest ||
  endSeconds > replay.duration
)
  throw Error("Exact original replay/window required");
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
let transportSequence = 0,
  matchedBytes = 0;
try {
  for (const chunk of replayChunks(replay, (bytes) =>
    Bun.zstdDecompressSync(bytes),
  )) {
    if (![1, 2].includes(chunk.stream)) continue;
    for (const block of replayBlocks(chunk)) {
      const sequence = transportSequence++;
      if (block.time > endSeconds || !opcodes.has(block.opcode)) continue;
      if (records.length >= 10000)
        throw Error(
          "Window capture exceeds10000 original objects; select a narrower explicit window",
        );
      const observation = decoder.observePacket(
        block.opcode,
        block.payload,
        block.param,
        { captureMemory: true },
      );
      if (!observation.complete)
        throw Error("Complete original packet reader required");
      matchedBytes +=
        observation.heap.byteLength +
        observation.object.byteLength +
        block.payload.byteLength;
      if (matchedBytes > 128 * 1024 * 1024)
        throw Error("Window capture exceeds128MiB source object/arena budget");
      records.push({
        opcode: block.opcode,
        time: block.time,
        param: block.param,
        stream: chunk.stream,
        chunkId: chunk.chunkId,
        blockOffset: block.blockOffset,
        transportSequence: sequence,
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
for (const [file, expected] of Object.entries(inputs))
  if (sha(await Bun.file(file).bytes()) !== expected)
    throw Error("Original capture source changed: " + file);
await Bun.write(
  outputArg,
  JSON.stringify(
    {
      schema: 1,
      kind: "original-packet-window-capture",
      build: replay.build,
      protocol: replay.protocol,
      replaySha256: sha(replayBytes),
      duration: replay.duration,
      decoderImageSha256: profile.decoderImageSha256,
      constructorImageSha256: profile.constructorImageSha256,
      opcodes: [...opcodes],
      window: {
        fromSeconds: 0,
        throughSeconds: endSeconds,
        maximumRecords: 10000,
        maximumSourceObjectBytes: 128 * 1024 * 1024,
      },
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
    sourceObjectBytes: matchedBytes,
    throughSeconds: endSeconds,
  }),
);
