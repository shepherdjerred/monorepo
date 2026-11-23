// Exact same-scene pre-observer report and independent native-prefix controls.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { BUFF_RESOURCE_ARGUMENT_PROGRAM } from "../latest-buff-resource-arguments.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const [beforeArg, afterArg, nativeArg, wholeArg, baselineArg, outputArg] =
  process.argv.slice(2);
if (!outputArg || process.argv.length !== 8)
  throw Error(
    "Usage: bun compare-map11-buff-observer.mjs <before.json> <after.json> <python-prefix.json> <whole-scan.json> <baseline-manifest.json> <output.json>",
  );
const inputs = {},
  sha = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
async function raw(file) {
  const path = resolve(file),
    bytes = await Bun.file(path).bytes(),
    digest = sha(bytes);
  assert(
    !inputs[path] || inputs[path] === digest,
    "Buff observer comparison source changed",
  );
  inputs[path] = digest;
  return bytes;
}
const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
await captureDirectSourceInputs([import.meta.path], raw);
const beforeBytes = await raw(beforeArg),
  before = decode(beforeBytes),
  after = decode(await raw(afterArg)),
  native = decode(await raw(nativeArg)),
  whole = decode(await raw(wholeArg)),
  baseline = decode(await raw(baselineArg));
assert.equal(
  baseline.kind,
  "isolated-before-buff-observer-regression-baseline",
);
assert.equal(baseline.changes.length, 7);
assert.equal(baseline.scope.nativeProgramsOrGatesChanged, false);
for (const [file, expected] of Object.entries(baseline.inputs))
  assert.equal(
    sha(await raw(file)),
    expected,
    "Baseline source drift: " + file,
  );
for (const source of [before, after, native, whole]) {
  assert.equal(source.build, BUFF_RESOURCE_ARGUMENT_PROGRAM.build);
  assert.equal(source.protocol, BUFF_RESOURCE_ARGUMENT_PROGRAM.protocol);
  assert.equal(
    source.decoderImageSha256 ?? source.program?.imageSha256,
    BUFF_RESOURCE_ARGUMENT_PROGRAM.imageSha256,
  );
}
assert.equal(native.kind, "original-buff-rpc-argument-prefix-controls");
assert.equal(native.boundary, null);
assert.equal(whole.kind, "original-replay-buff-resource-argument-inventory");
assert.equal(native.replaySha256, whole.replaySha256);
for (const [file, expected] of Object.entries({
  ...native.inputs,
  ...native.sources,
  ...whole.inputs,
}))
  assert.equal(sha(await raw(file)), expected, "Native source drift: " + file);
assert.deepEqual(
  after.buffResourceArgumentProgram,
  BUFF_RESOURCE_ARGUMENT_PROGRAM,
);
assert.equal(after.buffResourceArgumentScope.buffMembershipEstablished, false);
assert.equal(
  after.buffResourceArgumentScope.snapshotRestorationAccepted,
  false,
);
const originalFields = structuredClone(after);
for (const key of [
  "buffResourceArgumentProgram",
  "buffResourceArguments",
  "buffResourceSnapshots",
  "buffResourceArgumentScope",
]) {
  assert(!Object.hasOwn(before, key), "Baseline already contains the observer");
  delete originalFields[key];
}
assert.deepEqual(
  originalFields,
  before,
  "Every existing report field must remain exactly equal",
);
const serialized = new TextEncoder().encode(JSON.stringify(originalFields));
assert.equal(
  sha(serialized),
  sha(beforeBytes),
  "Entire original compact report bytes must match",
);
assert(after.buffResourceArguments.every((row) => row.stream === 1));
assert(after.buffResourceSnapshots.every((row) => row.stream === 2));
const actual = [
    ...after.buffResourceArguments,
    ...after.buffResourceSnapshots,
  ].sort((a, b) => a.transportSequence - b.transportSequence),
  expected = whole.records.filter((row) => row.time <= after.endTime);
assert.deepEqual(
  actual,
  expected,
  "Every new scalar/provenance record must equal the whole-match scan",
);
const python = native.records.filter(
  (row) => row.opcode === 1160 && row.time <= after.endTime,
);
assert.equal(actual.length, python.length);
assert(actual.length > 0);
const byOrdinal = new Map(actual.map((row) => [row.transportSequence, row]));
assert.equal(byOrdinal.size, actual.length);
for (const row of python) {
  const bytes = Buffer.from(row.originalBuffDescriptorHex, "hex"),
    target = byOrdinal.get(row.transportSequence);
  assert(target, "Original Python record missing from reconstructed inventory");
  for (const key of [
    "opcode",
    "time",
    "transportSequence",
    "stream",
    "chunkId",
    "blockOffset",
  ])
    assert.equal(target[key], row[key]);
  assert.equal(target.rawTransportParam, row.param);
  assert.equal(target.resourceNameHash, bytes.readUInt32LE(4));
  assert.equal(target.contextId, bytes.readUInt32LE(8));
}
for (const [file, expectedHash] of Object.entries(inputs))
  assert.equal(sha(await Bun.file(file).bytes()), expectedHash);
await Bun.write(
  outputArg,
  JSON.stringify(
    {
      schema: 1,
      kind: "exact-map11-buff-observer-regression-control",
      build: after.build,
      protocol: after.protocol,
      inputs,
      originalReportBytes: beforeBytes.length,
      originalReportSha256: sha(beforeBytes),
      matchedOriginalReportSha256: sha(serialized),
      originalReportFieldsExactlyEqual: true,
      nativeScalarRows: actual.length,
      gameplayRows: after.buffResourceArguments.length,
      snapshotRows: after.buffResourceSnapshots.length,
      nativePrefixAndWholeScanEqual: true,
      baselineSourceInputs: Object.keys(baseline.inputs).length,
      scope: {
        sameSceneAndPrograms: true,
        observerDoesNotChangeExistingSemantics: true,
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
    originalReportFieldsExactlyEqual: true,
    originalReportSha256: sha(beforeBytes),
    nativeScalarRows: actual.length,
    gameplayRows: after.buffResourceArguments.length,
    snapshotRows: after.buffResourceSnapshots.length,
  }),
);
