// Independent Python native-prefix controls versus the existing browser VM.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { StructuralDecoder } from "../structural-decoder.mjs";
import {
  createLatestBuffResourceArgumentReader,
  BUFF_RESOURCE_ARGUMENT_PROGRAM,
} from "../latest-buff-resource-arguments.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const [assetsArg, captureArg, proofArg, outputArg] = process.argv.slice(2);
if (!outputArg || process.argv.length !== 6)
  throw Error(
    "Usage: bun inspect-borrowed-buff-resource-arguments.mjs <approved-public-assets> <original-window.json> <python-native-prefix-proof.json> <output.json>",
  );
const inputs = {},
  sha = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
async function raw(file) {
  const path = resolve(file),
    bytes = await Bun.file(path).bytes(),
    digest = sha(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error("Borrowed prefix proof source changed: " + path);
  inputs[path] = digest;
  return bytes;
}
const json = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
await captureDirectSourceInputs([import.meta.path], raw);
const assets = resolve(assetsArg),
  root = resolve(assets, "decoder-16.21-macos"),
  profile = json(await raw(resolve(root, "profile.json"))),
  image = await raw(resolve(root, "image.bin")),
  constructors = await raw(resolve(root, "constructors.bin")),
  runtimePath = resolve(assets, "vendor/unicorn_x86_candidate.mjs"),
  runtime = json(await raw(runtimePath.replace(/\.mjs$/, ".json"))),
  captureBytes = await raw(captureArg),
  capture = json(captureBytes),
  native = json(await raw(proofArg));
assert.equal(sha(await raw(runtimePath)), runtime.sha256);
assert.equal(sha(image), profile.decoderImageSha256);
assert.equal(sha(constructors), profile.constructorImageSha256);
assert.equal(capture.kind, "original-packet-window-capture");
assert.equal(native.kind, "original-buff-rpc-argument-prefix-controls");
assert.equal(native.captureSha256, sha(captureBytes));
assert.equal(native.boundary, null);
assert.equal(native.decoderImageSha256, profile.decoderImageSha256);
for (const [file, expected] of Object.entries({
  ...capture.inputs,
  ...native.inputs,
  ...native.sources,
}))
  assert.equal(sha(await raw(file)), expected, "Native proof source: " + file);
const pairs = capture.records.filter((row) => row.opcode === 1160),
  expected = new Map(
    native.records
      .filter((row) => row.opcode === 1160)
      .map((row) => [row.transportSequence, row]),
  );
assert(pairs.length > 0 && pairs.length <= 10000);
assert.equal(pairs.length, expected.size);
const { default: createUnicorn } = await import(
  pathToFileURL(runtimePath).href
);
const decoder = new StructuralDecoder(
  await createUnicorn(),
  profile,
  image,
  constructors,
);
const reader = await createLatestBuffResourceArgumentReader({ decoder }),
  cases = [];
const registers = [
  "RAX",
  "RBX",
  "RCX",
  "RDX",
  "RSI",
  "RDI",
  "RSP",
  "RBP",
  "RIP",
  "R8",
  "R9",
  "R10",
  "R11",
  "R12",
  "R13",
  "R14",
  "R15",
  "EFLAGS",
];
const state = () => ({
  registers: registers.map((name) =>
    decoder.engine.reg_read_i64(decoder.uc["X86_REG_" + name]).toString(),
  ),
  heap: decoder.read(0x10200000, 0x10000),
  stack: decoder.read(0x2000f000, 0x2000),
  dirtyPages: [...decoder.dirtyPages],
});
let failureRestored = false,
  reentrancyRejected = false,
  closeRejected = false;
try {
  for (const row of pairs) {
    const payload = new Uint8Array(Buffer.from(row.payloadHex, "hex")),
      observation = decoder.observePacket(row.opcode, payload, row.param),
      python = expected.get(row.transportSequence);
    assert(observation.complete);
    assert.equal(
      Buffer.from(observation.object).toString("hex"),
      row.objectHex,
    );
    assert.equal(Buffer.from(observation.heap).toString("hex"), row.heapHex);
    assert.equal(python.time, row.time);
    const before = state(),
      actual = reader.read(observation),
      bytes = Buffer.from(python.originalBuffDescriptorHex, "hex");
    assert.deepEqual(actual, {
      resourceNameHash: bytes.readUInt32LE(4),
      contextId: bytes.readUInt32LE(8),
    });
    assert.deepEqual(state(), before, "Borrowed VM state must be restored");
    // The following original packet decode must remain byte-identical.
    const again = decoder.observePacket(row.opcode, payload, row.param);
    assert.deepEqual(again, observation);
    if (!cases.length) {
      const engine = decoder.engine,
        emulate = engine.emu_start;
      const fault = Error("Independent borrowed-execution failure control"),
        snapshot = state();
      try {
        engine.emu_start = () => {
          throw fault;
        };
        assert.throws(
          () => reader.read(observation),
          (error) => error === fault,
        );
      } finally {
        engine.emu_start = emulate;
      }
      assert.deepEqual(state(), snapshot);
      failureRestored = true;
      try {
        engine.emu_start = (...args) => {
          assert.throws(() => reader.read(observation), /already borrowed/);
          reentrancyRejected = true;
          return emulate.apply(engine, args);
        };
        assert.deepEqual(reader.read(observation), actual);
      } finally {
        engine.emu_start = emulate;
      }
      const bad = observation.object.slice();
      new DataView(bad.buffer).setUint32(8, 1195, true);
      assert.throws(
        () => reader.read({ ...observation, object: bad }),
        /RPC1160/,
      );
      assert.throws(
        () => reader.read({ ...observation, complete: false }),
        /RPC1160/,
      );
      assert.deepEqual(reader.read(observation), actual);
    }
    cases.push({
      transportSequence: row.transportSequence,
      time: row.time,
      ...actual,
    });
  }
  reader.close();
  reader.close();
  assert.throws(() => reader.read({}), /closed/);
  closeRejected = true;
} finally {
  reader.close();
  decoder.close();
}
for (const [file, digest] of Object.entries(inputs))
  assert.equal(
    sha(await Bun.file(file).bytes()),
    digest,
    "Changed input: " + file,
  );
await Bun.write(
  outputArg,
  JSON.stringify(
    {
      schema: 1,
      kind: "original-borrowed-vm-buff-resource-argument-controls",
      build: profile.clientVersion,
      protocol: profile.protocolDigest,
      program: BUFF_RESOURCE_ARGUMENT_PROGRAM,
      inputs,
      cases,
      controls: { failureRestored, reentrancyRejected, closeRejected },
      scope: {
        nativeScalarArgumentPrefixesEqual: true,
        decoderVmRestored: true,
        subsequentOriginalPacketUnchanged: true,
        additionalImageOrVmAllocated: false,
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
    cases: cases.length,
    controls: { failureRestored, reentrancyRejected, closeRejected },
  }),
);
