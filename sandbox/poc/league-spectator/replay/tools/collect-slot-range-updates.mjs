// Retain original decoded packet objects only; no setter meaning or live range admission.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openReplay, replayChunks, replayBlocks } from "../transport.mjs";
import { StructuralDecoder } from "../structural-decoder.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const [
  replayArgument,
  cacheArgument = ".cache/replay-spike",
  endArgument = "99",
] = process.argv.slice(2);
if (!replayArgument)
  throw Error(
    "Usage: bun collect-slot-range-updates.mjs <replay> [cache] [end-seconds]",
  );
const cache = resolve(cacheArgument),
  end = Number(endArgument),
  inputs = {};
if (!Number.isFinite(end) || end < 0) throw Error("Invalid end time");
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    digest = await sha256(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Input changed: ${path}`);
  inputs[path] = digest;
  return bytes;
}
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await raw(path)));
await captureDirectSourceInputs([import.meta.path], raw);
const runtimePath = `${cache}/public/vendor/unicorn_x86_candidate.mjs`,
  runtimeManifest = await read(runtimePath.replace(/\.mjs$/, ".json"));
if ((await sha256(await raw(runtimePath))) !== runtimeManifest.sha256)
  throw Error("Runtime hash mismatch");
const vendorPath = `${cache}/public/vendor/fzstd.mjs`;
await raw(vendorPath);
const { default: createUnicorn } = await import(pathToFileURL(runtimePath)),
  { decompress } = await import(pathToFileURL(vendorPath)),
  directory = `${cache}/public/decoder-16.21-macos`,
  profile = await read(`${directory}/profile.json`),
  image = await raw(`${directory}/image.bin`),
  constructors = await raw(`${directory}/constructors.bin`),
  replayBytes = await raw(replayArgument),
  replay = openReplay(
    replayBytes.buffer.slice(
      replayBytes.byteOffset,
      replayBytes.byteOffset + replayBytes.byteLength,
    ),
  );
if (
  replay.build !== profile.clientVersion ||
  replay.protocol !== profile.protocolDigest ||
  (await sha256(image)) !== profile.decoderImageSha256 ||
  (await sha256(constructors)) !== profile.constructorImageSha256
)
  throw Error("Exact build/protocol/decoder bytes required");
const decoder = new StructuralDecoder(
    await createUnicorn(),
    profile,
    image,
    constructors,
  ),
  records = [],
  rankRecords = [],
  counts = {};
let ordinal = 0;
for (const chunk of replayChunks(replay, decompress)) {
  if (![1, 2].includes(chunk.stream)) continue;
  for (const block of replayBlocks(chunk)) {
    const transportSequence = ordinal++;
    if (block.time > end || ![486, 678, 674, 1196].includes(block.opcode))
      continue;
    const observed = decoder.observePacket(
      block.opcode,
      block.payload,
      block.param,
    );
    if (
      !observed.complete ||
      observed.object.length !== (block.opcode === 486 ? 24 : 56)
    )
      throw Error(`Incomplete range-channel observation ${transportSequence}`);
    if (block.opcode === 486) {
      rankRecords.push({
        transportSequence,
        time: block.time,
        opcode: block.opcode,
        param: block.param,
        chunkId: block.chunkId,
        stream: block.stream,
        blockOffset: block.blockOffset,
        payloadSha256: await sha256(block.payload),
        payloadHex: Buffer.from(block.payload).toString("hex"),
        entryRva: observed.entryRva,
        objectHex: Buffer.from(observed.object).toString("hex"),
        heapHex: Buffer.from(observed.heap).toString("hex"),
      });
      counts[block.opcode] = (counts[block.opcode] ?? 0) + 1;
      continue;
    }
    const object = new DataView(
        observed.object.buffer,
        observed.object.byteOffset,
        observed.object.byteLength,
      ),
      pointer = Number(object.getBigUint64(0x10, true)),
      heapOffset = pointer - 0x10200000;
    // Preserve pointer contents as bytes; no interpretation of discriminant/slot/value here.
    if (
      pointer &&
      (!Number.isSafeInteger(pointer) ||
        heapOffset < 0 ||
        heapOffset > observed.heap.length)
    )
      throw Error(
        `Range-channel pointer outside original arena ${transportSequence}`,
      );
    records.push({
      transportSequence,
      time: block.time,
      opcode: block.opcode,
      param: block.param,
      chunkId: block.chunkId,
      stream: block.stream,
      blockOffset: block.blockOffset,
      payloadSha256: await sha256(block.payload),
      payloadHex: Buffer.from(block.payload).toString("hex"),
      entryRva: observed.entryRva,
      objectHex: Buffer.from(observed.object).toString("hex"),
      heapHex: Buffer.from(observed.heap).toString("hex"),
      pointerOffset: pointer ? heapOffset : null,
    });
    counts[block.opcode] = (counts[block.opcode] ?? 0) + 1;
  }
}
const result = {
  status: "PASS",
  kind: "original-slot-channel-structural-observations",
  build: replay.build,
  protocol: replay.protocol,
  endTime: end,
  totalTransportRecords: ordinal,
  counts,
  scope: {
    originalPacketDecoding: true,
    setterSemanticsEstablished: false,
    actualLiveRangeRecovered: false,
    activeDecoderIntegration: false,
    includesStreamTwo: true,
    ordering: "original-transport-ordinal",
  },
  records,
  rankRecords,
  inputs,
};
const output = `${cache}/research/slot-range-channel-observations-v35.json`;
await Bun.write(output, JSON.stringify(result));
console.log(
  JSON.stringify({
    status: result.status,
    counts,
    records: records.length,
    output,
  }),
);
