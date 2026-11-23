// Whole-container scalar argument inventory. Snapshot records remain separate
// from gameplay and are not applied as buff membership or world events.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openReplay, replayChunks, replayBlocks } from "../transport.mjs";
import { StructuralDecoder } from "../structural-decoder.mjs";
import { createLatestReconstructionWindow } from "../latest-reconstruction-window.mjs";
import {
  createLatestBuffResourceArgumentReader,
  BUFF_RESOURCE_ARGUMENT_PROGRAM,
} from "../latest-buff-resource-arguments.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const [assetsArg, replayArg, controlArg, outputArg] = process.argv.slice(2);
if (!outputArg || process.argv.length !== 6)
  throw Error(
    "Usage: bun inspect-replay-buff-resource-arguments.mjs <approved-public-assets> <exact.rofl> <borrowed-native-controls.json> <output.json>",
  );
const inputs = {},
  sha = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  decode = (bytes) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
async function raw(file) {
  const path = resolve(file),
    bytes = await Bun.file(path).bytes(),
    hash = sha(bytes);
  assert(
    !inputs[path] || inputs[path] === hash,
    "Buff inventory input changed: " + path,
  );
  inputs[path] = hash;
  return bytes;
}
await captureDirectSourceInputs([import.meta.path], raw);
const controlBytes = await raw(controlArg),
  control = decode(controlBytes);
assert.equal(
  control.kind,
  "original-borrowed-vm-buff-resource-argument-controls",
);
assert.deepEqual(control.program, BUFF_RESOURCE_ARGUMENT_PROGRAM);
assert.equal(control.scope.nativeScalarArgumentPrefixesEqual, true);
assert.equal(control.scope.decoderVmRestored, true);
assert.equal(control.scope.subsequentOriginalPacketUnchanged, true);
assert(control.cases.length > 0);
assert.deepEqual(control.controls, {
  failureRestored: true,
  reentrancyRejected: true,
  closeRejected: true,
});
for (const [file, expected] of Object.entries(control.inputs))
  assert.equal(
    sha(await raw(file)),
    expected,
    "Changed native control input: " + file,
  );
const assets = resolve(assetsArg),
  root = resolve(assets, "decoder-16.21-macos"),
  profile = decode(await raw(resolve(root, "profile.json"))),
  image = await raw(resolve(root, "image.bin")),
  constructors = await raw(resolve(root, "constructors.bin")),
  runtimePath = resolve(assets, "vendor/unicorn_x86_candidate.mjs"),
  runtime = decode(await raw(runtimePath.replace(/\.mjs$/, ".json"))),
  replayBytes = await raw(replayArg),
  replay = openReplay(replayBytes.buffer);
assert.equal(sha(await raw(runtimePath)), runtime.sha256);
assert.equal(sha(constructors), profile.constructorImageSha256);
assert.equal(replay.build, BUFF_RESOURCE_ARGUMENT_PROGRAM.build);
assert.equal(replay.protocol, BUFF_RESOURCE_ARGUMENT_PROGRAM.protocol);
const window = createLatestReconstructionWindow({
  declaredMilliseconds: replay.durationMilliseconds,
  requestedEndTimeSeconds: replay.duration,
});
for (const chunk of replayChunks(replay, (bytes) =>
  Bun.zstdDecompressSync(bytes),
))
  for (const block of replayBlocks(chunk)) window.observe(block);
const coverage = window.finish();
const { default: createUnicorn } = await import(
  pathToFileURL(runtimePath).href
);
const decoder = new StructuralDecoder(
    await createUnicorn(),
    profile,
    image,
    constructors,
  ),
  reader = await createLatestBuffResourceArgumentReader({ decoder }),
  records = [];
let transportSequence = 0;
const counts = {},
  pairs = new Set();
try {
  for (const chunk of replayChunks(replay, (bytes) =>
    Bun.zstdDecompressSync(bytes),
  )) {
    if (![1, 2].includes(chunk.stream)) continue;
    for (const block of replayBlocks(chunk)) {
      const ordinal = transportSequence++;
      if (block.opcode !== BUFF_RESOURCE_ARGUMENT_PROGRAM.opcode) continue;
      assert(block.time <= coverage.effectiveEndTimeSeconds);
      assert(
        records.length < 500000,
        "Original buff argument inventory exceeds500000 records",
      );
      const original = decoder.observePacket(
          block.opcode,
          block.payload,
          block.param,
        ),
        scalar = reader.read(original);
      records.push({
        opcode: block.opcode,
        time: block.time,
        rawTransportParam: block.param,
        stream: chunk.stream,
        chunkId: chunk.chunkId,
        blockOffset: block.blockOffset,
        transportSequence: ordinal,
        ...scalar,
      });
      counts[chunk.stream] = (counts[chunk.stream] ?? 0) + 1;
      pairs.add(scalar.resourceNameHash + ":" + scalar.contextId);
    }
  }
} finally {
  reader.close();
  decoder.close();
}
assert.equal(transportSequence, coverage.gameplayPackets);
for (const [file, expected] of Object.entries(inputs))
  assert.equal(
    sha(await Bun.file(file).bytes()),
    expected,
    "Changed buff inventory input: " + file,
  );
await Bun.write(
  outputArg,
  JSON.stringify(
    {
      schema: 1,
      kind: "original-replay-buff-resource-argument-inventory",
      build: replay.build,
      protocol: replay.protocol,
      replaySha256: sha(replayBytes),
      declaredDurationSeconds: replay.duration,
      coverage,
      program: BUFF_RESOURCE_ARGUMENT_PROGRAM,
      nativeControlSha256: sha(controlBytes),
      inputs,
      records,
      counts,
      scope: {
        originalPacketReaderExecuted: true,
        originalScalarArgumentPrefixExecuted: true,
        allOriginalGameplayAndSnapshotPacketsInspected: true,
        snapshotRestored: false,
        recordedEntityRoutingEstablished: false,
        resourceRegistryResolved: false,
        buffMembershipEstablished: false,
        liveAnimationProviderAdmitted: false,
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
    streams: counts,
    uniqueResourceContexts: pairs.size,
    declaredDurationSeconds: replay.duration,
    effectiveEndTimeSeconds: coverage.effectiveEndTimeSeconds,
  }),
);
