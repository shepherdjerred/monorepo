import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { createLatestAnimationMoveSpeedProvider } from "../latest-animation-provider-inputs.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const [reportFile, inputFile, nativeFile, outputFile] = process.argv.slice(2);
if (!outputFile || process.argv.length !== 6)
  throw Error(
    "Usage: bun compare-animation-move-speed.mjs <semantic-report> <native-input> <native-observations> <output>",
  );
const inputs = {};
async function raw(file) {
  const bytes = await Bun.file(file).bytes(),
    hash = await sha256(bytes);
  file = resolve(file);
  if (inputs[file] && inputs[file] !== hash)
    throw Error("MoveSpeed comparison input changed");
  inputs[file] = hash;
  return bytes;
}
const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
await captureDirectSourceInputs([import.meta.path], raw);
const report = decode(await raw(reportFile)),
  requestBytes = await raw(inputFile),
  request = decode(requestBytes),
  native = decode(await raw(nativeFile));
if (
  native.kind !== "original-concrete-hero-animation-move-speed-observations" ||
  native.boundary !== null ||
  native.inputSha256 !== (await sha256(requestBytes)) ||
  !native.scope.completeConcreteHeroConstructorsExecuted ||
  !native.scope.originalOwnerRttiCastExecuted ||
  !native.scope.originalReplicationAndCacheRefreshExecuted ||
  !native.scope.completeOriginalUpdaterExecuted ||
  native.scope.nativeFrameSchedulingEstablished !== false ||
  native.scope.nativeGraphInputsAdmitted !== false ||
  native.samples.length !== request.records.length ||
  native.heroCount !== report.heroes.length
)
  throw Error(
    "Complete scoped original concrete hero MoveSpeed observations required",
  );
if (request.inputs[resolve(reportFile)]?.sha256 !== inputs[resolve(reportFile)])
  throw Error("Native MoveSpeed proof must bind this exact semantic report");
for (const [file, hash] of Object.entries({
  ...native.inputs,
  ...native.sources,
}))
  if ((await sha256(await raw(file))) !== hash)
    throw Error("Original MoveSpeed prerequisite changed: " + file);
const bits = (value) => {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value, true);
  return view.getUint32(0, true);
};
const provider = createLatestAnimationMoveSpeedProvider(report);
const cases = [],
  prior = new Map();
for (let index = 0; index < request.records.length; index++) {
  const row = request.records[index],
    sample = native.samples[index];
  for (const key of ["entityId", "time", "transportSequence", "recordIndex"])
    if (sample[key] !== row[key])
      throw Error("Original MoveSpeed record cursor differs");
  if (sample.bits !== row.expectedBits)
    throw Error("Original MoveSpeed observed scalar differs");
  cases.push({
    row,
    before: prior.get(row.entityId) ?? null,
    after: sample.bits,
  });
  prior.set(row.entityId, sample.bits);
}
let queries = 0,
  unavailable = 0;
for (const direction of [cases, [...cases].reverse()]) {
  for (const { row, before, after } of direction) {
    for (const [exclusive, expected] of [
      [false, after],
      [true, before],
    ]) {
      const value = provider.sample(row.entityId, row.time, {
        transportSequence: row.transportSequence,
        recordIndex: row.recordIndex,
        exclusive,
      });
      if (expected === null) {
        if (value.status !== "unavailable")
          throw Error("Provider fabricated a pre-observation stat");
        unavailable++;
      } else if (value.status !== "observed" || bits(value.value) !== expected)
        throw Error(
          "Replay cursor MoveSpeed provider differs from original concrete hero updater",
        );
      queries++;
    }
  }
}
for (const [file, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(file).bytes())) !== hash)
    throw Error("MoveSpeed comparison source changed: " + file);
await Bun.write(
  resolve(outputFile),
  JSON.stringify(
    {
      schema: 1,
      kind: "verified-recorded-animation-move-speed-provider",
      inputs,
      heroes: report.heroes.length,
      records: request.records.length,
      writes: request.observed,
      queries,
      unavailable,
      provider: provider.describe(),
      scope: {
        originalConcreteHeroUpdaterCompared: true,
        causalForwardAndBackwardQueriesCompared: true,
        beforeFirstObservation: "unavailable",
        nativeFrameSchedulingEstablished: false,
        otherAnimationProvidersEstablished: false,
        nativeGraphInputsAdmitted: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    heroes: report.heroes.length,
    records: request.records.length,
    writes: request.observed,
    queries,
    unavailable,
  }),
);
