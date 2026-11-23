import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openReplay, replayChunks, replayBlocks } from "../transport.mjs";
import { StructuralDecoder } from "../structural-decoder.mjs";
import { sha256 } from "../structural-comparison.mjs";
import { createLatestFieldReader } from "../latest-fields.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

// Execute the original packet readers for every packet, including late-game
// classes. Keep only counts and one bounded failure example per opcode; this
// report establishes structural coverage, never rendered or semantic fidelity.
const [replayPath, assetRootArgument, outputPath, mode] = process.argv.slice(2);
if (
  !replayPath ||
  !assetRootArgument ||
  !outputPath ||
  (mode !== undefined && mode !== "initial")
)
  throw Error(
    "Usage: bun tools/inspect-full-decode.mjs <replay.rofl> <asset-root> <output.json> [initial]",
  );
const assetRoot = resolve(assetRootArgument);
const inputs = {};
const capture = async (file) => {
  const bytes = new Uint8Array(await Bun.file(file).arrayBuffer());
  inputs[file] = await sha256(bytes);
  return bytes;
};
await captureDirectSourceInputs([import.meta.path], capture);
const read = async (relative) => capture(resolve(assetRoot, relative));
const profile = JSON.parse(
  new TextDecoder().decode(await read("decoder-16.21-macos/profile.json")),
);
const image = await read("decoder-16.21-macos/image.bin");
const constructors = await read("decoder-16.21-macos/constructors.bin");
const runtimePath = resolve(assetRoot, "vendor/unicorn_x86_candidate.mjs");
const runtimeManifest = await Bun.file(
  resolve(assetRoot, "vendor/unicorn_x86_candidate.json"),
).json();
await capture(runtimePath);
await read("vendor/fzstd.mjs");
if (
  (await sha256(await Bun.file(runtimePath).arrayBuffer())) !==
    runtimeManifest.sha256 ||
  (await sha256(image)) !== profile.decoderImageSha256 ||
  (await sha256(constructors)) !== profile.constructorImageSha256
)
  throw Error("Original decoder input integrity failure");
const { default: createUnicorn } = await import(
  pathToFileURL(runtimePath).href
);
const { decompress } = await import(
  pathToFileURL(resolve(assetRoot, "vendor/fzstd.mjs")).href
);
const buffer = (await capture(resolve(replayPath))).buffer;
const replay = openReplay(buffer);
if (
  replay.build !== profile.clientVersion ||
  replay.protocol !== profile.protocolDigest
)
  throw Error("Replay differs from the original decoder build/protocol");
const decoder = new StructuralDecoder(
  await createUnicorn(),
  profile,
  image,
  constructors,
);
const started = performance.now();
const codecBytes = await read("decoder-16.21-macos/field-codecs.json");
if ((await sha256(codecBytes)) !== profile.fieldCodecsSha256)
  throw Error("Original field-codec integrity failure");
const fields = createLatestFieldReader(
  profile,
  JSON.parse(new TextDecoder().decode(codecBytes)),
);
const heroes = [];
let startupObservation = null;
const classes = {},
  streams = {};
let packets = 0,
  expandedBytes = 0,
  peakRss = process.memoryUsage().rss,
  lastGameplayTime = 0;
try {
  for (const chunk of replayChunks(replay, decompress, {
    streams: mode === "initial" ? [2, 3] : [1, 2],
  })) {
    expandedBytes += chunk.body.byteLength;
    for (const block of replayBlocks(chunk)) {
      if (
        mode === "initial" &&
        !(
          (chunk.stream === 2 && block.opcode === 1049 && block.time === 0) ||
          (chunk.stream === 3 && block.opcode === 728)
        )
      )
        continue;
      packets++;
      streams[chunk.stream] = (streams[chunk.stream] ?? 0) + 1;
      if (chunk.stream === 1)
        lastGameplayTime = Math.max(lastGameplayTime, block.time);
      const entry = (classes[block.opcode] ??= {
        packets: 0,
        complete: 0,
        rejected: 0,
        unprepared: 0,
        exceptions: 0,
        firstTime: block.time,
        lastTime: block.time,
        payloadBytes: 0,
        maximumHeapBytes: 0,
      });
      entry.packets++;
      entry.firstTime = Math.min(entry.firstTime, block.time);
      entry.lastTime = Math.max(entry.lastTime, block.time);
      entry.payloadBytes += block.payload.byteLength;
      if (!profile.packets[block.opcode]) entry.unprepared++;
      else {
        try {
          const observed = decoder.observePacket(
            block.opcode,
            block.payload,
            block.param,
            {
              captureMemory:
                (chunk.stream === 2 &&
                  block.time === 0 &&
                  block.opcode === 1049) ||
                (chunk.stream === 3 && block.opcode === 728),
            },
          );
          if (chunk.stream === 2 && block.time === 0 && block.opcode === 1049)
            heroes.push(fields.heroCreation(observed));
          if (chunk.stream === 3 && block.opcode === 728) {
            if (startupObservation !== null || !observed.complete)
              throw Error("One complete original startup observation required");
            startupObservation = {
              objectHex: Buffer.from(observed.object).toString("hex"),
              heapHex: Buffer.from(observed.heap).toString("hex"),
              payloadSha256: await sha256(block.payload),
            };
          }
          entry.maximumHeapBytes = Math.max(
            entry.maximumHeapBytes,
            observed.heapSize,
          );
          if (observed.complete) entry.complete++;
          else {
            entry.rejected++;
            entry.firstFailure ??= {
              time: block.time,
              stream: chunk.stream,
              accepted: observed.accepted,
              consumed: observed.consumed,
              bytes: block.payload.byteLength,
            };
          }
        } catch (error) {
          entry.exceptions++;
          entry.firstFailure ??= {
            time: block.time,
            stream: chunk.stream,
            message: String(error).slice(0, 512),
          };
        }
      }
      if (packets % 10000 === 0) {
        peakRss = Math.max(peakRss, process.memoryUsage().rss);
        console.error(
          JSON.stringify({
            packets,
            lastGameplayTime,
            elapsedSeconds: (performance.now() - started) / 1000,
            peakRss,
          }),
        );
      }
    }
  }
} finally {
  decoder.close();
}
peakRss = Math.max(peakRss, process.memoryUsage().rss);
for (const [file, expected] of Object.entries(inputs)) {
  if ((await sha256(await Bun.file(file).arrayBuffer())) !== expected)
    throw Error(`Decoder input changed during verification: ${file}`);
}
const report = {
  schema: 1,
  kind: "original-full-match-structural-decoding",
  replaySha256: await sha256(buffer),
  build: replay.build,
  protocol: replay.protocol,
  duration: replay.duration,
  roster: replay.roster,
  heroes,
  startupObservation,
  packets,
  streams,
  lastGameplayTime,
  expandedBytes,
  decodeMs: performance.now() - started,
  peakRss,
  classes,
  inputs,
  semanticFidelityEstablished: false,
  renderedFidelityEstablished: false,
};
await Bun.write(outputPath, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({ ...report, classes: Object.keys(classes).length }),
);
