// All snapshot times remain separate from gameplay; ordinals count every packet.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openReplay, replayChunks, replayBlocks } from "../transport.mjs";
import { sha256 } from "../structural-comparison.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  endTime = Number(process.argv[3] ?? 99),
  inputs = {};
const bytes = async (path) => {
  const raw = await Bun.file(path).bytes();
  inputs[path] = await sha256(raw);
  return raw;
};
const read = async (path) =>
  JSON.parse(new TextDecoder().decode(await bytes(path)));
for (const path of [
  import.meta.path,
  resolve(import.meta.dir, "../transport.mjs"),
  resolve(import.meta.dir, "../structural-comparison.mjs"),
])
  await bytes(path);
const installation = await read(`${cache}/latest-installation.json`),
  profile = await read(`${cache}/public/decoder-16.21-macos/profile.json`),
  raw = await bytes(installation.replay.file);
if ((await sha256(raw)) !== installation.replay.sha256)
  throw Error("Visibility mask replay changed");
const replay = openReplay(
  raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
);
if (
  replay.build !== profile.clientVersion ||
  replay.protocol !== profile.protocolDigest ||
  !Number.isFinite(endTime) ||
  endTime < 0 ||
  endTime > replay.duration
)
  throw Error("Invalid exact-build visibility mask window");
const vendor = `${cache}/public/vendor/fzstd.mjs`;
await bytes(vendor);
const { decompress } = await import(pathToFileURL(vendor));
const packets = {};
let ordinal = 0,
  selected = 0;
for (const chunk of replayChunks(replay, decompress)) {
  if (![1, 2].includes(chunk.stream)) continue;
  for (const block of replayBlocks(chunk)) {
    const transportSequence = ordinal++;
    if (![48, 582, 918].includes(block.opcode) || block.time > endTime)
      continue;
    packets[`${chunk.stream}:${block.opcode}:${selected++}`] = {
      opcode: block.opcode,
      stream: chunk.stream,
      time: block.time,
      param: block.param,
      chunkId: chunk.chunkId,
      blockOffset: block.blockOffset,
      transportSequence,
      payloadHex: Buffer.from(block.payload).toString("hex"),
    };
  }
}
// Opcode918 is absent in this replay. Execute its actual decoder with supplied
// empty body/header identities as explicit controls, never as replay events.
packets["control:918:0"] = {
  opcode: 918,
  param: 0x4000003d,
  payloadHex: "",
  control: true,
};
for (const [path, expected] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== expected)
    throw Error(`Mask sample changed: ${path}`);
const output = `${cache}/research/target-visibility-masks-input.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      build: replay.build,
      protocol: replay.protocol,
      replaySha256: installation.replay.sha256,
      selection: {
        endTime,
        allSnapshotRecords: true,
        streamsRetainedSeparately: true,
        acceptedVisibility: false,
      },
      packets,
      inputs,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    replayPackets: selected,
    controls: 1,
    snapshots: Object.values(packets).filter((p) => p.stream === 2).length,
  }),
);
