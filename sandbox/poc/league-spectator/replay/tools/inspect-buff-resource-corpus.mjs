// Combine complete original argument inventories without joining match clocks.
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { BUFF_RESOURCE_ARGUMENT_PROGRAM } from "../latest-buff-resource-arguments.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const [sceneArg, builtinArg, outputArg, ...sourceArgs] = process.argv.slice(2);
if (!outputArg || !sourceArgs.length || sourceArgs.length > 16)
  throw Error(
    "Usage: bun inspect-buff-resource-corpus.mjs <scene-root> <builtin-context-program> <output.json> <whole-inventory1.json> [whole-inventory2.json ...]",
  );
const inputs = {},
  sha = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
async function raw(file) {
  const path = resolve(file),
    bytes = await Bun.file(path).bytes(),
    hash = sha(bytes);
  assert(
    !inputs[path] || inputs[path] === hash,
    "Buff corpus source changed: " + path,
  );
  inputs[path] = hash;
  return bytes;
}
const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
await captureDirectSourceInputs([import.meta.path], raw);
const sceneBytes = await raw(join(sceneArg, "manifest.json")),
  scene = decode(sceneBytes),
  builtinBytes = await raw(builtinArg);
assert.equal(scene.build, BUFF_RESOURCE_ARGUMENT_PROGRAM.build);
assert.equal(scene.protocol, BUFF_RESOURCE_ARGUMENT_PROGRAM.protocol);
assert.equal(
  sha(builtinBytes),
  "3fab8bb246b194bce340574b555b0eb3f271ff288e2cdd00c8ef6c2ae545cbb5",
);
const requests = new Map(),
  sources = [],
  replayIds = new Set();
for (const file of sourceArgs) {
  const bytes = await raw(file),
    source = decode(bytes);
  assert.equal(source.kind, "original-replay-buff-resource-argument-inventory");
  assert.deepEqual(source.program, BUFF_RESOURCE_ARGUMENT_PROGRAM);
  assert.equal(source.coverage.scope, "whole-container");
  assert.equal(source.coverage.originalTimestampsRetained, true);
  assert.equal(source.scope.originalScalarArgumentPrefixExecuted, true);
  assert.equal(source.scope.buffMembershipEstablished, false);
  assert.equal(source.build, scene.build);
  assert.equal(source.protocol, scene.protocol);
  assert(
    !replayIds.has(source.replaySha256),
    "Duplicate replay in buff corpus",
  );
  replayIds.add(source.replaySha256);
  assert(source.records.length > 0 && source.records.length <= 500000);
  for (const [path, expected] of Object.entries(source.inputs))
    assert.equal(
      sha(await raw(path)),
      expected,
      "Changed original inventory input: " + path,
    );
  const digest = sha(bytes),
    pairs = new Map();
  let prior = -1;
  const counts = {};
  for (const row of source.records) {
    assert.equal(row.opcode, 1160);
    assert([1, 2].includes(row.stream));
    assert(
      Number.isFinite(row.time) &&
        row.time >= 0 &&
        row.time <= source.coverage.effectiveEndTimeSeconds,
    );
    assert(
      Number.isSafeInteger(row.transportSequence) &&
        row.transportSequence > prior,
    );
    prior = row.transportSequence;
    for (const value of [row.contextId, row.resourceNameHash])
      assert(Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff);
    counts[row.stream] = (counts[row.stream] ?? 0) + 1;
    const key = row.contextId + "/" + row.resourceNameHash,
      cursor = {
        time: row.time,
        transportSequence: row.transportSequence,
        stream: row.stream,
      };
    if (!pairs.has(key))
      pairs.set(key, {
        occurrences: 0,
        streams: {},
        firstCursor: cursor,
        lastCursor: cursor,
      });
    const pair = pairs.get(key);
    pair.occurrences++;
    pair.streams[row.stream] = (pair.streams[row.stream] ?? 0) + 1;
    pair.lastCursor = cursor;
    if (!requests.has(key))
      requests.set(key, {
        contextId: row.contextId,
        resourceNameHash: row.resourceNameHash,
        contextIdentity:
          row.contextId === 3579051965
            ? "original-shared-identity"
            : "recorded-identity-requires-causal-registry",
        occurrences: 0,
        matches: [],
      });
  }
  assert.deepEqual(counts, source.counts);
  for (const [key, value] of pairs) {
    const request = requests.get(key);
    request.occurrences += value.occurrences;
    request.matches.push({
      replaySha256: source.replaySha256,
      sourceInventorySha256: digest,
      ...value,
    });
  }
  sources.push({
    file: resolve(file),
    sha256: digest,
    replaySha256: source.replaySha256,
    declaredDurationSeconds: source.declaredDurationSeconds,
    coverage: source.coverage,
    records: source.records.length,
  });
}
for (const [file, expected] of Object.entries(inputs))
  assert.equal(sha(await Bun.file(file).bytes()), expected);
const result = {
  schema: 1,
  kind: "recorded-buff-resource-requests",
  build: scene.build,
  protocol: scene.protocol,
  decoderImageSha256: BUFF_RESOURCE_ARGUMENT_PROGRAM.imageSha256,
  sceneManifestSha256: sha(sceneBytes),
  builtinResourceContextsSha256: sha(builtinBytes),
  sources,
  requests: [...requests.values()].sort(
    (a, b) =>
      a.contextId - b.contextId || a.resourceNameHash - b.resourceNameHash,
  ),
  inputs,
  scope: {
    completeOriginalArgumentInventories: true,
    separateReplayClocksAndCursors: true,
    snapshotsRestored: false,
    contextRegistryHistoryEstablished: false,
    buffMembershipEstablished: false,
    liveHomeguardProviderAdmitted: false,
  },
};
await Bun.write(outputArg, JSON.stringify(result, null, 2));
console.log(
  JSON.stringify({
    output: resolve(outputArg),
    replays: sources.length,
    records: sources.reduce((sum, row) => sum + row.records, 0),
    resourceContextRequests: requests.size,
  }),
);
